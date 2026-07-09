import "server-only";
import { sql, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { tokenMetadata, ammPools } from "@/db/schema";
import { query as chQuery } from "@/lib/clickhouse-client";
import { xrplClient } from "./xrpl-client";
import { decodeCurrency, dropsToXrp } from "./xrpl-helpers";
import { parseAMMAsset } from "./amm-helpers";
import { orderbookCache, tokenDetailCache } from "./cache";
import logger from "./logger";
import type {
  TokenDetail,
  BookOffer,
  OrderbookEntry,
  DepthLevel,
  TokenAMMPool,
} from "@/types/token";
import type { AMMInfoResponse } from "@/types/xrpl-responses";

/* ---------- Token detail (own DB + live orderbook price) ---------- */

/**
 * Derive a live XRP price from the best ask on the DEX orderbook.
 * book_offers(token, XRP) → TakerGets=token, TakerPays=XRP → price = XRP/token
 */
async function getLivePrice(
  currency: string,
  issuer: string,
): Promise<number | null> {
  try {
    const result = await xrplClient.getBookOffers(
      { currency, issuer },
      { currency: "XRP" },
      1,
    );

    const offer = result.offers?.[0];
    if (!offer) return null;

    const tokenAmt = parseAmount(offer.TakerGets);
    const xrpAmt = parseAmount(offer.TakerPays);
    if (tokenAmt <= 0) return null;

    const price = xrpAmt / tokenAmt;
    return isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export async function getTokenDetail(
  currency: string,
  issuer: string,
): Promise<TokenDetail | null> {
  const cacheKey = `${currency}:${issuer}`;
  const cached = tokenDetailCache.get(cacheKey) as TokenDetail | undefined;
  if (cached) return cached;

  try {
    // Fetch metadata from PG + live price + volume from CH in parallel.
    // CH `mv_token_volume_hourly` indexes by base/quote — sum across both
    // sides so token-token pairs are counted regardless of side. The
    // ingester pre-computes XRP-equivalent volume on every fill, so
    // summing xrp_volume_drops produces a complete XRP-denominated total.
    const buildSumQuery = (intervalDays: number) => `
      SELECT toString(sum(drops)) AS xrp_drops FROM (
        SELECT sum(xrp_volume_drops) AS drops
        FROM mv_token_volume_hourly
        WHERE hour >= now() - INTERVAL ${intervalDays} DAY
          AND base_currency = {currency:String}
          AND base_issuer = {issuer:String}
        UNION ALL
        SELECT sum(xrp_volume_drops) AS drops
        FROM mv_token_volume_hourly
        WHERE hour >= now() - INTERVAL ${intervalDays} DAY
          AND quote_currency = {currency:String}
          AND quote_issuer = {issuer:String}
      )`;

    const [metaRows, price, vol24hRows, vol7dRows] = await Promise.all([
      db
        .select()
        .from(tokenMetadata)
        .where(and(eq(tokenMetadata.currency, currency), eq(tokenMetadata.issuer, issuer)))
        .limit(1),
      getLivePrice(currency, issuer),
      chQuery<{ xrp_drops: string | null }>(buildSumQuery(1), { currency, issuer }),
      chQuery<{ xrp_drops: string | null }>(buildSumQuery(7), { currency, issuer }),
    ]);

    const meta = metaRows[0] ?? null;
    const vol24h = Number(vol24hRows[0]?.xrp_drops ?? 0) / 1_000_000;
    const vol7d = Number(vol7dRows[0]?.xrp_drops ?? 0) / 1_000_000;

    // If token has no DB metadata, no price, and no volume — it's genuinely unknown
    if (!meta && !price && vol24h === 0 && vol7d === 0) return null;

    const detail: TokenDetail = {
      currency,
      currencyDisplay: decodeCurrency(currency),
      issuer,
      meta: {
        name: meta?.name ?? null,
        icon: meta?.icon ?? null,
        issuerName: meta?.issuerName ?? null,
      },
      metrics: {
        price,
        volume24h: vol24h > 0 ? vol24h : null,
        volume7d: vol7d > 0 ? vol7d : null,
        marketcap: null,
        holders: meta?.holders ?? null,
        trustlines: meta?.trustlines ?? null,
      },
    };

    tokenDetailCache.set(cacheKey, detail);
    return detail;
  } catch {
    return null;
  }
}

/* ---------- Orderbook ---------- */

function parseAmount(
  amount: string | { currency: string; issuer: string; value: string }
): number {
  if (typeof amount === "string") {
    // XRP in drops
    return parseFloat(dropsToXrp(amount));
  }
  return parseFloat(amount.value);
}

function processOffers(
  offers: BookOffer[],
  side: "bid" | "ask"
): OrderbookEntry[] {
  const entries: OrderbookEntry[] = [];

  for (const offer of offers) {
    let price: number;
    let amount: number;

    if (side === "bid") {
      // Bid: book_offers(xrp, token) → TakerGets = XRP, TakerPays = token
      const xrpAmt = parseAmount(offer.TakerGets);
      const tokenAmt = parseAmount(offer.TakerPays);
      if (tokenAmt <= 0) continue;
      price = xrpAmt / tokenAmt;
      amount = tokenAmt;
    } else {
      // Ask: book_offers(token, xrp) → TakerGets = token, TakerPays = XRP
      const tokenAmt = parseAmount(offer.TakerGets);
      const xrpAmt = parseAmount(offer.TakerPays);
      if (tokenAmt <= 0) continue;
      price = xrpAmt / tokenAmt;
      amount = tokenAmt;
    }

    if (!isFinite(price) || price <= 0) continue;

    entries.push({
      price,
      amount,
      total: 0,
      xrpTotal: 0,
      account: offer.Account,
    });
  }

  // Sort: bids descending (best bid first), asks ascending (best ask first)
  if (side === "bid") {
    entries.sort((a, b) => b.price - a.price);
  } else {
    entries.sort((a, b) => a.price - b.price);
  }

  // Compute cumulative totals
  let cumAmount = 0;
  let cumXrp = 0;
  for (const e of entries) {
    cumAmount += e.amount;
    cumXrp += e.amount * e.price;
    e.total = cumAmount;
    e.xrpTotal = cumXrp;
  }

  return entries;
}

export function toDepthLevels(entries: OrderbookEntry[]): DepthLevel[] {
  return entries.map((e) => ({
    price: e.price,
    cumulativeAmount: e.total,
    cumulativeXrp: e.xrpTotal,
  }));
}

export async function getOrderbook(
  currency: string,
  issuer: string
): Promise<{ bids: OrderbookEntry[]; asks: OrderbookEntry[] }> {
  const cacheKey = `book:${currency}:${issuer}`;
  const cached = orderbookCache.get(cacheKey) as
    | { bids: OrderbookEntry[]; asks: OrderbookEntry[] }
    | undefined;
  if (cached) return cached;

  const token = { currency, issuer };
  const xrp = { currency: "XRP" };

  try {
    // book_offers(token, xrp): maker sells token for XRP → ASK orders
    // book_offers(xrp, token): maker sells XRP for token → BID orders
    const [askResult, bidResult] = await Promise.allSettled([
      xrplClient.getBookOffers(token, xrp, 50),
      xrplClient.getBookOffers(xrp, token, 50),
    ]);

    // Log transient WS failures so we can tell "token has no orderbook" apart
    // from "rippled call timed out" when a user reports an empty book.
    if (askResult.status === "rejected") {
      logger.warn(
        { err: askResult.reason, currency, issuer, side: "ask" },
        "[token-detail-data] getBookOffers (ask side) failed — orderbook may render empty",
      );
    }
    if (bidResult.status === "rejected") {
      logger.warn(
        { err: bidResult.reason, currency, issuer, side: "bid" },
        "[token-detail-data] getBookOffers (bid side) failed — orderbook may render empty",
      );
    }

    const bids = processOffers(
      bidResult.status === "fulfilled" ? (bidResult.value.offers ?? []) : [],
      "bid"
    );
    const asks = processOffers(
      askResult.status === "fulfilled" ? (askResult.value.offers ?? []) : [],
      "ask"
    );

    const result = { bids, asks };
    // Only cache when at least one side succeeded. If both calls failed we
    // want the next request to retry, not serve an empty book for 10s.
    if (bidResult.status === "fulfilled" || askResult.status === "fulfilled") {
      orderbookCache.set(cacheKey, result);
    }
    return result;
  } catch (err) {
    logger.warn(
      { err, currency, issuer },
      "[token-detail-data] getOrderbook threw unexpectedly",
    );
    return { bids: [], asks: [] };
  }
}

/* ---------- AMM Pools ---------- */

function parseAMMInfo(
  info: AMMInfoResponse,
  targetCurrency: string,
  targetIssuer: string,
): TokenAMMPool | null {
  const amm = info.amm;
  const side1 = parseAMMAsset(amm.amount);
  const side2 = parseAMMAsset(amm.amount2);

  // Match: which side is the token this page is about?
  const side1IsTarget =
    side1.currency === targetCurrency && side1.issuer === targetIssuer;
  const side2IsTarget =
    side2.currency === targetCurrency && side2.issuer === targetIssuer;

  // If neither side matches the target token, the pool data is inconsistent
  if (!side1IsTarget && !side2IsTarget) return null;

  const target = side1IsTarget ? side1 : side2;
  const paired = side1IsTarget ? side2 : side1;

  return {
    ammAccount: amm.account,
    targetAmount: isFinite(target.value) ? target.value : 0,
    pairedAmount: isFinite(paired.value) ? paired.value : 0,
    pairedLabel: paired.label,
    pairedIsXrp: paired.isXrp,
    pairedCurrency: paired.currency,
    pairedIssuer: paired.issuer,
    tradingFee: amm.trading_fee,
    lpHolders: 0,
    lpTokenSupply: parseFloat(amm.lp_token.value) || 0,
  };
}

export async function getTokenAMMPools(
  currency: string,
  issuer: string
): Promise<TokenAMMPool[]> {
  try {
    // Find matching pools from our DB
    const pools = await db
      .select()
      .from(ammPools)
      .where(
        sql`(${ammPools.asset2Currency} = ${currency} AND ${ammPools.asset2Issuer} = ${issuer})
         OR (${ammPools.asset1Currency} = ${currency} AND ${ammPools.asset1Issuer} = ${issuer})`,
      );

    if (pools.length > 0) {
      const enriched = await Promise.allSettled(
        pools.map(async (p) => {
          const info = await xrplClient.getAMMInfo(
            p.account
          );
          return parseAMMInfo(info, currency, issuer);
        })
      );

      return enriched
        .filter(
          (r): r is PromiseFulfilledResult<TokenAMMPool | null> =>
            r.status === "fulfilled"
        )
        .map((r) => r.value)
        .filter((v): v is TokenAMMPool => v != null);
    }

    // Fallback: query XRPL directly by asset pair (pool may not be in DB yet)
    const info = await xrplClient.getAMMInfoByAssets(
      { currency: "XRP" },
      { currency, issuer }
    );

    if (!info?.amm) return [];
    const parsed = parseAMMInfo(info, currency, issuer);
    return parsed ? [parsed] : [];
  } catch {
    return [];
  }
}
