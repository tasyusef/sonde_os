/**
 * Token list data — reads from PG `token_metadata` for static fields and
 * CH `mv_token_volume_hourly` for 24h/7d XRP-volume aggregates. Zero
 * external API calls at page-load time (live orderbook prices live on
 * `getTokensForPriceMap` / token-detail-data, not here).
 *
 * Types and pure functions are in token-types.ts (importable from client components).
 * This file is server-only (DB queries).
 */

import "server-only";
import { sql, eq, and, or, ilike } from "drizzle-orm";
import { db } from "@/db";
import { tokenMetadata } from "@/db/schema";
import { query as chQuery } from "@/lib/clickhouse-client";
import { decodeCurrency, dropsToXrp, XRPL_ADDRESS_RE } from "./xrpl-helpers";
import { xrplClient } from "./xrpl-client";
import { LRUCache } from "./cache";
import type { TokenListItem } from "./token-types";

/* Re-export types and pure functions so existing imports still work */
export type { TokenListItem, TokenMetrics, TokenMeta, VolumePeriod } from "./token-types";
export { sortTokensByVolume } from "./token-types";

/* ------------------------------------------------------------------ */
/*  Caches — separate for token list vs price map to avoid eviction    */
/* ------------------------------------------------------------------ */

const tokenListCache = new LRUCache<{
  tokens: TokenListItem[];
  total: number;
}>(10, 300_000);

const priceMapCache = new LRUCache<TokenListItem[]>(50, 30_000);

/* ------------------------------------------------------------------ */
/*  Shared: build volume maps for a set of tokens                      */
/*                                                                     */
/*  Reads from CH `mv_token_volume_hourly`. The token ↔ XRP convention */
/*  in `dex_trades` puts the token on `base_*` when paired with XRP,   */
/*  but token-token trades can have the target token on either side.   */
/*  We aggregate both directions and sum xrp_volume_drops, since the   */
/*  ingester pre-computes XRP-equivalent volume per fill.              */
/* ------------------------------------------------------------------ */

async function getVolumeMaps(
  pairs: { currency: string; issuer: string }[],
): Promise<{ vol24hMap: Map<string, number>; vol7dMap: Map<string, number> }> {
  const vol24hMap = new Map<string, number>();
  const vol7dMap = new Map<string, number>();
  if (pairs.length === 0) return { vol24hMap, vol7dMap };

  // Build a tuple-list filter for both sides of the pair (target token
  // on base or on quote). Pre-formatted as a CH array literal for the
  // `has(...)` check — currency/issuer are already-validated XRPL types,
  // so no SQL injection risk.
  const tupleList = pairs
    .map((p) => `('${escapeChStr(p.currency)}','${escapeChStr(p.issuer)}')`)
    .join(",");

  const buildQuery = (intervalDays: number) => `
    SELECT currency, issuer, sum(xrp_drops) AS xrp_drops FROM (
      SELECT base_currency AS currency, base_issuer AS issuer,
             sum(xrp_volume_drops) AS xrp_drops
      FROM mv_token_volume_hourly
      WHERE hour >= now() - INTERVAL ${intervalDays} DAY
        AND (base_currency, base_issuer) IN (${tupleList})
      GROUP BY base_currency, base_issuer
      UNION ALL
      SELECT quote_currency AS currency, quote_issuer AS issuer,
             sum(xrp_volume_drops) AS xrp_drops
      FROM mv_token_volume_hourly
      WHERE hour >= now() - INTERVAL ${intervalDays} DAY
        AND (quote_currency, quote_issuer) IN (${tupleList})
      GROUP BY quote_currency, quote_issuer
    )
    GROUP BY currency, issuer`;

  const [vol24h, vol7d] = await Promise.all([
    chQuery<{ currency: string; issuer: string; xrp_drops: string | number }>(
      buildQuery(1),
    ),
    chQuery<{ currency: string; issuer: string; xrp_drops: string | number }>(
      buildQuery(7),
    ),
  ]);

  for (const v of vol24h) {
    vol24hMap.set(`${v.currency}:${v.issuer}`, Number(v.xrp_drops ?? 0) / 1_000_000);
  }
  for (const v of vol7d) {
    vol7dMap.set(`${v.currency}:${v.issuer}`, Number(v.xrp_drops ?? 0) / 1_000_000);
  }

  return { vol24hMap, vol7dMap };
}

/** Strip single quotes from values being inlined into a CH string literal.
 *  Currency codes (3-char ASCII or 40-char hex) and r-addresses can never
 *  contain quotes, so this is defense-in-depth — never trust the caller. */
function escapeChStr(value: string): string {
  return value.replace(/'/g, "");
}

/* ------------------------------------------------------------------ */
/*  Shared: map a DB row to TokenListItem                              */
/* ------------------------------------------------------------------ */

interface TokenMetadataRow {
  currency: string;
  issuer: string;
  name: string | null;
  icon: string | null;
  issuerName: string | null;
  holders: number | null;
  trustlines: number | null;
  latestPrice: string | null;
}

function toTokenListItem(
  row: TokenMetadataRow,
  vol24hMap: Map<string, number>,
  vol7dMap: Map<string, number>,
): TokenListItem {
  const key = `${row.currency}:${row.issuer}`;
  const price = row.latestPrice != null ? parseFloat(row.latestPrice) : null;
  return {
    currency: row.currency,
    currencyDisplay: decodeCurrency(row.currency),
    issuer: row.issuer,
    meta: {
      name: row.name,
      icon: row.icon,
      issuerName: row.issuerName,
    },
    metrics: {
      price: price != null && isFinite(price) && price > 0 ? price : null,
      volume24h: vol24hMap.get(key) ?? null,
      volume7d: vol7dMap.get(key) ?? null,
      marketcap: null, // Computed client-side once supply is applied
      holders: row.holders,
      trustlines: row.trustlines,
      totalSupply: null,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  getTokenList — main query                                          */
/* ------------------------------------------------------------------ */

const metadataColumns = {
  currency: tokenMetadata.currency,
  issuer: tokenMetadata.issuer,
  name: tokenMetadata.name,
  icon: tokenMetadata.icon,
  issuerName: tokenMetadata.issuerName,
  holders: tokenMetadata.holders,
  trustlines: tokenMetadata.trustlines,
  latestPrice: tokenMetadata.latestPrice,
};

export async function getTokenList(
  offset = 0,
  limit = 100,
): Promise<{ tokens: TokenListItem[]; total: number }> {
  const cacheKey = `token-list:${offset}:${limit}`;
  const cached = tokenListCache.get(cacheKey);
  if (cached) return cached;

  // Fetch metadata + count in parallel (count doesn't depend on rows).
  // Order by COALESCE(holders, trustlines, 0) so tokens with a trustline
  // count but no holder snapshot still rank above unsnapshotted ones —
  // important for newly-active tokens (memecoins, fresh listings) that
  // would otherwise sink under "NULLS LAST" and be invisible on page 0.
  const [rows, [countRow]] = await Promise.all([
    db
      .select(metadataColumns)
      .from(tokenMetadata)
      .orderBy(
        sql`COALESCE(${tokenMetadata.holders}, ${tokenMetadata.trustlines}, 0) DESC`,
      )
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(tokenMetadata),
  ]);

  // Volume + supply in parallel (both only need the pairs list)
  const pairs = rows.map((r) => ({ currency: r.currency, issuer: r.issuer }));
  const [{ vol24hMap, vol7dMap }, supplyMap] = await Promise.all([
    getVolumeMaps(pairs),
    getSupplyMap(pairs),
  ]);

  const tokens = rows.map((row) => {
    const item = toTokenListItem(row, vol24hMap, vol7dMap);
    const key = `${row.currency}:${row.issuer}`;
    item.metrics.totalSupply = supplyMap.get(key) ?? null;
    return item;
  });
  const total = countRow?.count ?? tokens.length;

  const result = { tokens, total };
  tokenListCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  getTokenListWithSupply — enriched with total supply from snapshots  */
/* ------------------------------------------------------------------ */

const supplyCache = new LRUCache<Map<string, number>>(5, 300_000);

async function getSupplyMap(
  pairs: { currency: string; issuer: string }[],
): Promise<Map<string, number>> {
  if (pairs.length === 0) return new Map();

  const cacheKey = `supply:${pairs.map((p) => `${p.currency}:${p.issuer}`).sort().join(",")}`;
  const cached = supplyCache.get(cacheKey);
  if (cached) return cached;

  // CH equivalent of PG's `DISTINCT ON (currency, issuer) ... ORDER BY
  // snapshot_time DESC` — argMax returns the value associated with the
  // maximum sort column. Single scan instead of N round-trips.
  const currencies = pairs.map((p) => p.currency);
  const issuers = pairs.map((p) => p.issuer);

  const rows = await chQuery<{
    currency: string;
    issuer: string;
    total_supply: number;
  }>(
    `SELECT
       currency,
       issuer,
       argMax(total_supply, snapshot_time) AS total_supply
     FROM token_holder_snapshots
     WHERE (currency, issuer) IN (
       SELECT arrayJoin(arrayZip({currencies:Array(String)}, {issuers:Array(String)}))
     )
     GROUP BY currency, issuer`,
    { currencies, issuers },
  );

  const supplyMap = new Map<string, number>();
  for (const row of rows) {
    if (row.total_supply > 0) supplyMap.set(`${row.currency}:${row.issuer}`, row.total_supply);
  }

  supplyCache.set(cacheKey, supplyMap);
  return supplyMap;
}

export async function getTokenListWithSupply(
  offset = 0,
  limit = 100,
): Promise<{ tokens: TokenListItem[]; total: number; hasMore: boolean }> {
  // Supply is now fetched in parallel with volumes inside getTokenList
  const { tokens, total } = await getTokenList(offset, limit);
  return { tokens, total, hasMore: offset + limit < total };
}

/* ------------------------------------------------------------------ */
/*  searchTokens — full-table search beyond what page 0 can show       */
/* ------------------------------------------------------------------ */

/**
 * Encode a 1-20 char ASCII ticker into the XRPL hex form: 40-char
 * uppercase hex, the ASCII bytes followed by zero-padding. Used to match
 * 4+ char tickers (BWIF, FARM, BERT) against the `currency` column,
 * since those are stored hex-encoded on-ledger. Returns null for input
 * that doesn't fit (>20 ASCII chars or non-printable).
 */
function encodeTickerToHex(ticker: string): string | null {
  if (ticker.length === 0 || ticker.length > 20) return null;
  if (!/^[\x20-\x7E]+$/.test(ticker)) return null;
  const hex = Buffer.from(ticker, "ascii").toString("hex").toUpperCase();
  return hex.padEnd(40, "0");
}

const tokenSearchCache = new LRUCache<TokenListItem[]>(50, 60_000);

/**
 * Search the full token_metadata table by ticker, name, issuer name, or
 * issuer address. Returns up to `limit` enriched tokens. Used by the
 * markets-page filter as a fallback when local results are empty, so
 * tokens past page 0 of the leaderboard are still findable.
 */
export async function searchTokens(
  query: string,
  limit = 20,
): Promise<TokenListItem[]> {
  const q = query.trim();
  if (q.length === 0) return [];

  // XRPL encodes 4+ char tickers as hex preserving input case, so `bwif`
  // (62776966…) and `BWIF` (42574946…) are genuinely different tokens.
  // Keep the cache key case-sensitive so they don't collide.
  const cacheKey = `search:${q}:${limit}`;
  const cached = tokenSearchCache.get(cacheKey);
  if (cached) return cached;

  const conditions = [];

  // Issuer address (full or prefix match for typing flow)
  if (q.length >= 10 && q.startsWith("r") && XRPL_ADDRESS_RE.test(q)) {
    conditions.push(eq(tokenMetadata.issuer, q));
  } else if (q.startsWith("r") && q.length >= 4) {
    conditions.push(ilike(tokenMetadata.issuer, `${q}%`));
  }

  // 40-char hex → exact currency-code match. Covers the case where the
  // user pastes a token's raw on-ledger currency hash (e.g. from another
  // explorer or a wallet that exposes the hex). Without this, the only
  // hex inputs we'd resolve are 4-char tickers re-encoded to hex below,
  // and nothing matched a literal 40-char hex query.
  if (q.length === 40 && /^[A-Fa-f0-9]{40}$/.test(q)) {
    conditions.push(eq(tokenMetadata.currency, q.toUpperCase()));
  }

  // Raw 3-char currency code. These are the only codes stored literally
  // (not hex) on-ledger, and XRPL treats them case-sensitively — "btc"
  // and "BTC" are different currencies. Match the input case exactly,
  // but also fall through to the hex branch below so users who type
  // "usd" still find USD-named 4+ char tokens.
  if (q.length === 3 && /^[A-Za-z]{3}$/.test(q)) {
    conditions.push(eq(tokenMetadata.currency, q));
  }

  // 4-20 char ASCII ticker → hex prefix match. XRPL hex-encodes these
  // preserving case, so we must hex the ORIGINAL input (not uppercased)
  // to avoid conflating lowercase + uppercase variants. Skip when the
  // input is already 40-char hex.
  const isAlreadyHex = q.length === 40 && /^[A-Fa-f0-9]{40}$/.test(q);
  if (!isAlreadyHex && q.length >= 2) {
    const prefix = encodeTickerToHex(q);
    if (prefix) {
      // Trim the hex to just the real ASCII bytes (before null-padding)
      // so we match any currency that starts with those bytes — lets
      // "bw" find "bwif" while still preserving input case.
      const usedHex = Buffer.from(q, "ascii").toString("hex").toUpperCase();
      conditions.push(ilike(tokenMetadata.currency, `${usedHex}%`));
    }
  }

  // Friendly name + issuer name fields (set by seed-tokens.ts)
  conditions.push(ilike(tokenMetadata.name, `%${q}%`));
  conditions.push(ilike(tokenMetadata.issuerName, `%${q}%`));

  const rows = await db
    .select(metadataColumns)
    .from(tokenMetadata)
    .where(or(...conditions))
    .orderBy(sql`${tokenMetadata.holders} DESC NULLS LAST`)
    .limit(limit);

  if (rows.length === 0) {
    tokenSearchCache.set(cacheKey, []);
    return [];
  }

  const pairs = rows.map((r) => ({ currency: r.currency, issuer: r.issuer }));
  const [{ vol24hMap, vol7dMap }, supplyMap] = await Promise.all([
    getVolumeMaps(pairs),
    getSupplyMap(pairs),
  ]);

  const tokens = rows.map((row) => {
    const item = toTokenListItem(row, vol24hMap, vol7dMap);
    item.metrics.totalSupply = supplyMap.get(`${row.currency}:${row.issuer}`) ?? null;
    return item;
  });

  tokenSearchCache.set(cacheKey, tokens);
  return tokens;
}

/* ------------------------------------------------------------------ */
/*  Live orderbook price lookup (XRP-denominated)                       */
/* ------------------------------------------------------------------ */

interface BookOffersResult {
  offers?: {
    TakerGets: string | { currency: string; issuer: string; value: string };
    TakerPays: string | { currency: string; issuer: string; value: string };
  }[];
}

function parseAmount(
  amount: string | { currency: string; issuer: string; value: string },
): number {
  if (typeof amount === "string") return parseFloat(dropsToXrp(amount));
  return parseFloat(amount.value);
}

/**
 * Fetch live XRP-denominated prices for a batch of tokens via DEX orderbook.
 * Returns a map of "currency:issuer" → price in XRP.
 * Concurrency-limited to avoid hammering the XRPL node.
 */
async function getLivePrices(
  pairs: { currency: string; issuer: string }[],
): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  if (pairs.length === 0) return priceMap;

  // Fetch in batches of 10 to limit concurrent WS requests
  const CONCURRENCY = 10;
  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (p) => {
        const result = (await xrplClient.getBookOffers(
          { currency: p.currency, issuer: p.issuer },
          { currency: "XRP" },
          1,
        )) as BookOffersResult;

        const offer = result.offers?.[0];
        if (!offer) return null;

        const tokenAmt = parseAmount(offer.TakerGets);
        const xrpAmt = parseAmount(offer.TakerPays);
        if (tokenAmt <= 0) return null;

        const price = xrpAmt / tokenAmt;
        return isFinite(price) && price > 0 ? { key: `${p.currency}:${p.issuer}`, price } : null;
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        priceMap.set(r.value.key, r.value.price);
      }
    }
  }

  return priceMap;
}

/* ------------------------------------------------------------------ */
/*  getTokensForPriceMap — targeted lookup for specific tokens          */
/*  Used by AccountDataLoader & portfolio API to get metadata + prices  */
/* ------------------------------------------------------------------ */

const PRICE_MAP_BATCH_SIZE = 50;

export async function getTokensForPriceMap(
  pairs: { currency: string; issuer: string }[],
): Promise<TokenListItem[]> {
  if (pairs.length === 0) return [];

  const cacheKey = `pm:${pairs.map((p) => `${p.currency}:${p.issuer}`).sort().join(",")}`;
  const cached = priceMapCache.get(cacheKey);
  if (cached) return cached;

  // Batch OR conditions to keep queries bounded (max 50 conditions per
  // query). Batches fire in parallel — same query count as the prior
  // serial loop, but wall-clock collapses to the slowest single batch
  // instead of summing them. Hot path for portfolio AMM and account-
  // page token pricing on accounts holding many distinct tokens.
  const batches: { currency: string; issuer: string }[][] = [];
  for (let i = 0; i < pairs.length; i += PRICE_MAP_BATCH_SIZE) {
    batches.push(pairs.slice(i, i + PRICE_MAP_BATCH_SIZE));
  }
  const batchResults = await Promise.all(
    batches.map((batch) => {
      const conditions = batch.map((p) =>
        and(eq(tokenMetadata.currency, p.currency), eq(tokenMetadata.issuer, p.issuer)),
      );
      return db
        .select(metadataColumns)
        .from(tokenMetadata)
        .where(conditions.length === 1 ? conditions[0] : or(...conditions));
    }),
  );
  const allRows: TokenMetadataRow[] = batchResults.flat();

  // Fetch live orderbook prices for all tokens in parallel
  const livePrices = await getLivePrices(
    allRows.map((r) => ({ currency: r.currency, issuer: r.issuer })),
  );

  const emptyMap = new Map<string, number>();
  const tokens = allRows.map((row) => {
    const item = toTokenListItem(row, emptyMap, emptyMap);
    const livePrice = livePrices.get(`${row.currency}:${row.issuer}`);
    if (livePrice != null) {
      item.metrics.price = livePrice;
    }
    return item;
  });

  priceMapCache.set(cacheKey, tokens);
  return tokens;
}
