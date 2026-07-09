import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { tokenMetadata } from "@/db/schema";
import { query as chQuery } from "@/lib/clickhouse-client";
import { decodeCurrency } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

/* ------------------------------------------------------------------ */
/*  Top Tokens — shared query layer                                    */
/*                                                                     */
/*  Three orphan datasets that were only ever surfaced on marketing    */
/*  cards. Lifting them here so both the admin marketing snapshot      */
/*  (fetchMarketingData) and the public network / markets analytics    */
/*  surfaces can share one source of truth.                            */
/* ------------------------------------------------------------------ */

/* ── Top Gainers ─────────────────────────────────────────────────── */

export interface TopGainerRow {
  currency: string;
  issuer: string;
  ticker: string;
  priceNow: number;
  price24hAgo: number;
  volume24hXrp: number;
  pctChange: number;
}

export type MoverDirection = "gainers" | "losers";

/**
 * Top XRPL tokens by 24h price change %, filtered to legitimate
 * tokens only (≥50 trustlines). Direction selects gainers (positive
 * movers, sorted DESC) or losers (negative movers, sorted ASC).
 *
 * Pricing windows:
 * - Current = most recent close in last 24h (hour bucket aggregate).
 * - Prior   = most recent close in the 18-30h-ago window
 *             (12h wide, centred on 24h ago).
 *
 * Current was 6h originally — much narrower than the 24h liquidity
 * filter — which dropped any token that traded heavily 8-23h ago but
 * went quiet recently. Now both windows match in scale: every liquid
 * token has a current price, and `argMax(hour)` on the prior window
 * gives a close as close to 24h ago as the data allows.
 *
 * - Liquidity sanity floors: ≥5K XRP volume, ≥10 trades over last 24h.
 * - Legitimacy gate: token_metadata.trustlines ≥ 50.
 *
 * `direction` defaults to "gainers" so existing callers (marketing-data)
 * keep working without changes.
 */
export async function getTopGainers24h(
  limit = 10,
  direction: MoverDirection = "gainers",
): Promise<TopGainerRow[]> {
  try {
    // CH `mv_token_volume_hourly` stores OHLC as AggregatingMergeTree —
    // close_price needs `argMaxMerge`, open uses `argMinMerge`. We compute
    // the 24h "close now" price from the most recent hour bucket of the
    // last 6h, and the "24h ago" price from the bucket nearest the
    // 24h-ago point (22-27h window). The token-XRP convention from
    // dex_trades is base = token, quote = 'XRP', so we filter on that.
    //
    // Fetch a generous oversample (50x) so we have enough rows to
    // apply the trustline≥100 gate via PG `token_metadata` join, then
    // trim to `limit` after merging. Bigger oversample because the
    // gate is permissive enough that most candidates fall out at the
    // price-pair-stitch step (no prior-period close).
    const oversample = Math.max(limit * 50, 200);

    // 1) Liquid pairs in last 24h (≥5K XRP volume, ≥10 trades).
    const liquid = await chQuery<{
      base_currency: string;
      base_issuer: string;
      volume_24h_drops: string | number;
      trades_24h: string | number;
    }>(
      `SELECT base_currency, base_issuer,
              toString(sum(xrp_volume_drops)) AS volume_24h_drops,
              sum(trade_count) AS trades_24h
       FROM mv_token_volume_hourly
       WHERE hour >= now() - INTERVAL 24 HOUR
         AND quote_currency = 'XRP'
       GROUP BY base_currency, base_issuer
       HAVING sum(xrp_volume_drops) >= 5000000000
          AND sum(trade_count) >= 10
       ORDER BY sum(xrp_volume_drops) DESC
       LIMIT {limit:UInt32}`,
      { limit: oversample },
    );

    if (liquid.length === 0) return [];

    // 2) Current price — most recent close anywhere in last 24h.
    //
    // The window matches the liquidity filter above (also 24h) on
    // purpose: every token that's "liquid today" has at least one
    // hour bucket inside the same 24h window, so it WILL have a
    // priceNow. Previous 6h window dropped any token that traded
    // earlier today but went quiet recently.
    const current = await chQuery<{
      base_currency: string;
      base_issuer: string;
      price_now: number | string;
    }>(
      `SELECT base_currency, base_issuer,
              argMax(close_p, hour) AS price_now
       FROM (
         SELECT hour, base_currency, base_issuer,
                argMaxMerge(close_price) AS close_p
         FROM mv_token_volume_hourly
         WHERE hour >= now() - INTERVAL 24 HOUR
           AND quote_currency = 'XRP'
         GROUP BY hour, base_currency, base_issuer
       )
       WHERE close_p > 0
       GROUP BY base_currency, base_issuer`,
    );

    // 3) Prior price — most recent close in 18-30h-ago window (12h
    // wide, centred on 24h ago). `argMax(hour)` picks the close at
    // the most recent eligible hour, which is as close to 24h ago
    // as the data allows. Window history:
    //   - 22-27h (5h) → far too narrow; almost everyone dropped
    //   - 18-30h (12h, current) → wide enough to catch most tokens
    //     that traded near 24h ago without sliding so far that the
    //     "24h" label loses meaning.
    const prior = await chQuery<{
      base_currency: string;
      base_issuer: string;
      price_24h_ago: number | string;
    }>(
      `SELECT base_currency, base_issuer,
              argMax(close_p, hour) AS price_24h_ago
       FROM (
         SELECT hour, base_currency, base_issuer,
                argMaxMerge(close_price) AS close_p
         FROM mv_token_volume_hourly
         WHERE hour >= now() - INTERVAL 30 HOUR
           AND hour <  now() - INTERVAL 18 HOUR
           AND quote_currency = 'XRP'
         GROUP BY hour, base_currency, base_issuer
       )
       WHERE close_p > 0
       GROUP BY base_currency, base_issuer`,
    );

    // 4) Stitch in JS — match liquid pairs to current + prior, compute pct change.
    const currentMap = new Map(
      current.map((c) => [`${c.base_currency}:${c.base_issuer}`, Number(c.price_now)]),
    );
    const priorMap = new Map(
      prior.map((p) => [`${p.base_currency}:${p.base_issuer}`, Number(p.price_24h_ago)]),
    );

    const isLosers = direction === "losers";
    type Candidate = {
      currency: string;
      issuer: string;
      priceNow: number;
      price24hAgo: number;
      volume24hDrops: number;
      pctChange: number;
    };
    const candidates: Candidate[] = [];
    for (const row of liquid) {
      const key = `${row.base_currency}:${row.base_issuer}`;
      const priceNow = currentMap.get(key);
      const priceThen = priorMap.get(key);
      if (priceNow == null || priceThen == null) continue;
      if (!(priceNow > 0) || !(priceThen > 0)) continue;
      if (isLosers ? !(priceNow < priceThen) : !(priceNow > priceThen)) continue;
      const pct = ((priceNow - priceThen) / priceThen) * 100;
      candidates.push({
        currency: row.base_currency,
        issuer: row.base_issuer,
        priceNow,
        price24hAgo: priceThen,
        volume24hDrops: Number(row.volume_24h_drops),
        pctChange: pct,
      });
    }

    if (candidates.length === 0) return [];

    // 5) Trustline ≥ 50 gate via PG `token_metadata` (the metadata join
    // stays in PG since CH doesn't have token_metadata). Threshold has
    // walked down over time:
    //   - 200 originally — too restrictive, card showed 2-3 rows
    //   - 100 — still too restrictive given how few XRPL tokens cross
    //     that bar with actual price-change data both ends of the day
    //   - 50 — current. Excludes truly trivial tokens (single-digit
    //     holders) but lets the long tail of real projects through.
    const pairs = candidates.map((c) => ({ currency: c.currency, issuer: c.issuer }));
    const metaRows = await db
      .select({
        currency: tokenMetadata.currency,
        issuer: tokenMetadata.issuer,
        trustlines: tokenMetadata.trustlines,
      })
      .from(tokenMetadata)
      .where(
        or(
          ...pairs.map((p) =>
            and(
              eq(tokenMetadata.currency, p.currency),
              eq(tokenMetadata.issuer, p.issuer),
            ),
          ),
        ),
      );
    const eligible = new Set(
      metaRows
        .filter((m) => (m.trustlines ?? 0) >= 50)
        .map((m) => `${m.currency}:${m.issuer}`),
    );

    const filtered = candidates.filter((c) => eligible.has(`${c.currency}:${c.issuer}`));

    // 6) Sort by pct change in the requested direction, take top N.
    filtered.sort((a, b) => (isLosers ? a.pctChange - b.pctChange : b.pctChange - a.pctChange));

    return filtered.slice(0, limit).map((c) => ({
      currency: c.currency,
      issuer: c.issuer,
      ticker: decodeCurrency(c.currency),
      priceNow: c.priceNow,
      price24hAgo: c.price24hAgo,
      volume24hXrp: c.volume24hDrops / 1_000_000,
      pctChange: c.pctChange,
    }));
  } catch (err) {
    logger.error({ err, direction }, "[top-tokens] getTopGainers24h failed");
    return [];
  }
}

/* ── Top DEX Pairs ───────────────────────────────────────────────── */

export interface TopDexPairRow {
  baseCurrency: string;
  baseIssuer: string;
  quoteCurrency: string;
  quoteIssuer: string;
  /** Decoded base ticker (hex → ASCII; LP tokens → "LP"). */
  baseTicker: string;
  /** Decoded quote ticker. */
  quoteTicker: string;
  trades: number;
  xrpVolumeDrops: string;
}

/**
 * Top trading pairs by XRP-denominated volume over a window (in days).
 * Reads from ClickHouse mv_dex_pair_daily.
 */
export async function getTopDexPairs(
  windowDays: number,
  limit = 10,
): Promise<TopDexPairRow[]> {
  try {
    const rows = (await chQuery(`
      SELECT base_currency, base_issuer, quote_currency, quote_issuer,
             sum(trade_count) AS trades,
             sum(xrp_volume_drops) AS xrp_volume_drops
      FROM sonde.mv_dex_pair_daily
      WHERE day > today() - ${windowDays}
      GROUP BY base_currency, base_issuer, quote_currency, quote_issuer
      ORDER BY xrp_volume_drops DESC
      LIMIT ${limit}
    `)) as {
      base_currency: string;
      base_issuer: string;
      quote_currency: string;
      quote_issuer: string;
      trades: string | number;
      xrp_volume_drops: string;
    }[];

    return rows.map((r) => ({
      baseCurrency: r.base_currency,
      baseIssuer: r.base_issuer,
      quoteCurrency: r.quote_currency,
      quoteIssuer: r.quote_issuer,
      baseTicker: tickerFromCurrency(r.base_currency),
      quoteTicker: tickerFromCurrency(r.quote_currency),
      trades: Number(r.trades),
      xrpVolumeDrops: String(r.xrp_volume_drops),
    }));
  } catch (err) {
    logger.error({ err }, "[top-tokens] getTopDexPairs failed");
    return [];
  }
}

/** XRPL currency → readable ticker. "XRP" passes through, 40-char hex
 * starting with "03" is an AMM LP token (not a real ticker). */
function tickerFromCurrency(currency: string): string {
  if (!currency) return "?";
  if (currency === "XRP") return "XRP";
  if (currency.length === 40 && currency.startsWith("03")) return "LP";
  return decodeCurrency(currency);
}

/* ── Trustline Winners ───────────────────────────────────────────── */

export interface TrustlineWinnerRow {
  currency: string;
  issuer: string;
  /** Decoded ticker (hex → ASCII; LP tokens → "LP"). */
  ticker: string;
  added: number;
  removed: number;
  netNew: number;
}

/**
 * Top tokens by net new trustlines over a window (in days).
 * Reads from ClickHouse mv_trustline_counts. `minNetNew` gate
 * filters out trivially-small changes.
 */
export async function getTrustlineWinners(
  windowDays: number,
  minNetNew: number,
  limit = 10,
): Promise<TrustlineWinnerRow[]> {
  try {
    const rows = (await chQuery(`
      SELECT currency, issuer,
             toInt64(sum(trustlines_added)) AS added,
             toInt64(sum(trustlines_removed)) AS removed,
             toInt64(sum(trustlines_added) - sum(trustlines_removed)) AS net_new
      FROM sonde.mv_trustline_counts
      WHERE event_date > today() - ${windowDays}
      GROUP BY currency, issuer
      HAVING net_new > ${minNetNew}
      ORDER BY net_new DESC
      LIMIT ${limit}
    `)) as {
      currency: string;
      issuer: string;
      added: string | number;
      removed: string | number;
      net_new: string | number;
    }[];

    return rows.map((r) => ({
      currency: r.currency,
      issuer: r.issuer,
      ticker: tickerFromCurrency(r.currency),
      added: Number(r.added),
      removed: Number(r.removed),
      netNew: Number(r.net_new),
    }));
  } catch (err) {
    logger.error({ err }, "[top-tokens] getTrustlineWinners failed");
    return [];
  }
}
