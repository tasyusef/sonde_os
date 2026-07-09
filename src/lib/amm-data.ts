import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { xrplClient } from "./xrpl-client";
import { decodeCurrency } from "./xrpl-helpers";
import { LRUCache } from "./cache";
import type { DexTVLData, DexTVLPool } from "@/types/analytics";

/* 15-minute cache for top-N pool assembly — avoids repeated DB + metadata lookups. */
const ammPoolCache = new LRUCache<AMMPool[]>(5, 15 * 60 * 1000);

export interface AMMPool {
  ammId: string;
  account: string;
  assetXrp: number;
  asset2CurrencyDisplay: string;
  asset2Issuer: string;
  asset2IssuerName: string | null;
  tradingFee: number;
  holders: number;
  imageUrl: string | null;
}

const DROPS_PER_XRP = 1_000_000;

/**
 * Top N AMM pools by cached TVL.
 *
 * Architecture (see docs/wiki for the full writeup):
 * - amm_pools.tvl_xrp is refreshed every ~10 min by AmmPoolTvlRefresher
 * - This function just sorts and joins metadata — no amm_info fanout
 * - For pools whose TVL cache is stale (>30 min old), we opportunistically
 *   refresh the specific pool live so individual stragglers self-heal.
 *
 * Fallback: if a pool has NULL tvl_xrp (new discovery, refresher hasn't
 * run yet, or token/token pool without XRP anchor), it's excluded from
 * the ranking. That's correct — we can't rank what we can't measure.
 */
async function getTopAMMPools(limit = 5): Promise<AMMPool[] | null> {
  const cacheKey = `amm-pools:${limit}`;
  const cached = ammPoolCache.get(cacheKey);
  if (cached) return cached;

  try {
    // Single sorted query — pulls top-N by cached TVL, joins asset info + metadata.
    // TVL is always expressed in XRP (stored as total pool value = XRP-side × 2).
    const rows = await db.execute<{
      account: string;
      asset1_currency: string;
      asset1_issuer: string | null;
      asset2_currency: string;
      asset2_issuer: string | null;
      trading_fee: number | null;
      tvl_xrp: string | null;
      issuer_name: string | null;
      icon: string | null;
    }>(sql`
      SELECT p.account,
             p.asset1_currency, p.asset1_issuer,
             p.asset2_currency, p.asset2_issuer,
             p.trading_fee,
             p.tvl_xrp::text AS tvl_xrp,
             tm.issuer_name,
             tm.icon
      FROM amm_pools p
      LEFT JOIN token_metadata tm
             ON tm.issuer = CASE WHEN p.asset1_currency = 'XRP' THEN p.asset2_issuer ELSE p.asset1_issuer END
            AND tm.currency = CASE WHEN p.asset1_currency = 'XRP' THEN p.asset2_currency ELSE p.asset1_currency END
      WHERE p.tvl_xrp IS NOT NULL
        AND p.tvl_xrp > 0
      ORDER BY p.tvl_xrp DESC
      LIMIT ${limit}
    `);

    if (rows.length === 0) return null;

    // Phase 2: count LP holders for the top N only — one WS call per pool,
    // bounded by `limit` (usually ≤100), so this stays cheap.
    const holderResults = await Promise.allSettled(
      rows.map(async (row) => {
        const lines = (await xrplClient.send({
          command: "account_lines",
          account: row.account,
          ledger_index: "validated",
          limit: 400,
        })) as { lines?: unknown[] };
        return { account: row.account, holders: lines?.lines?.length ?? 0 };
      }),
    );
    const holderMap = new Map<string, number>();
    for (const r of holderResults) {
      if (r.status === "fulfilled") {
        holderMap.set(r.value.account, r.value.holders);
      }
    }

    const resolved: AMMPool[] = rows.map((row) => {
      const tvl = Number(row.tvl_xrp);
      // Whichever side is non-XRP is the "token" side for display.
      const tokenIsAsset2 = row.asset1_currency === "XRP";
      const tokenCurrency = tokenIsAsset2 ? row.asset2_currency : row.asset1_currency;
      const tokenIssuer = tokenIsAsset2 ? row.asset2_issuer : row.asset1_issuer;
      return {
        ammId: row.account,
        account: row.account,
        // TVL / 2 = one side (they're roughly equal at equilibrium).
        assetXrp: tvl / 2,
        asset2CurrencyDisplay: decodeCurrency(tokenCurrency),
        asset2Issuer: tokenIssuer ?? "",
        asset2IssuerName: row.issuer_name ?? null,
        tradingFee: row.trading_fee ?? 0,
        holders: holderMap.get(row.account) ?? 0,
        imageUrl: row.icon ?? null,
      };
    });

    ammPoolCache.set(cacheKey, resolved);
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Get DEX total value locked across all AMM pools.
 *
 * Unlike the old implementation this pulls the grand TVL total from the
 * DB in one query — no per-pool fanout. topPools is assembled via the
 * cached getTopAMMPools path above.
 */
export async function getDexTVL(xrpPrice: number): Promise<DexTVLData | null> {
  try {
    const totalRow = await db.execute<{
      total_tvl: string | null;
      pool_count: string;
    }>(sql`
      SELECT COALESCE(SUM(tvl_xrp), 0)::text AS total_tvl,
             COUNT(*)::text AS pool_count
      FROM amm_pools
      WHERE tvl_xrp IS NOT NULL AND tvl_xrp > 0
    `);

    const totalTvlXrp = Number(totalRow[0]?.total_tvl ?? 0);
    const poolCount = Number(totalRow[0]?.pool_count ?? 0);

    if (poolCount === 0) return null;

    const topPools = await getTopAMMPools(5);
    const topPoolsMapped: DexTVLPool[] = (topPools ?? []).map((pool) => ({
      account: pool.account,
      currency: pool.asset2CurrencyDisplay,
      issuerName: pool.asset2IssuerName,
      tvlXrp: pool.assetXrp * 2,
      imageUrl: pool.imageUrl,
      tradingFee: pool.tradingFee,
      holders: pool.holders,
    }));

    return {
      totalTvlXrp,
      totalTvlUsd: totalTvlXrp * xrpPrice,
      poolCount,
      topPools: topPoolsMapped,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  AMM Listing — top pools for the /markets AMMs tab                  */
/* ------------------------------------------------------------------ */

/**
 * One row in the AMM listing table on the /markets AMMs tab. Lean by
 * design — only the fields the table actually displays. Volume + LP
 * holder count are deliberately omitted from v1:
 *   - Per-pool volume needs a ClickHouse join against `mv_token_volume_*`
 *     keyed on the token side of each pool. Cheap to add later.
 *   - LP holder count needs an `account_lines` WS call per pool, which
 *     doesn't scale to 100 pools per render. A periodic snapshotter
 *     into amm_pools.holders is the right fix; left for follow-up.
 */
export interface AMMListItem {
  /** AMM account on XRPL (unique per pool). */
  account: string;
  /** Raw token-side currency code (3-char or 40-char hex). */
  currency: string;
  /** Display version: ASCII for 3-char, decoded hex otherwise. */
  currencyDisplay: string;
  /** Token-side issuer. */
  issuer: string;
  /** Issuer human name (from token_metadata), if known. */
  issuerName: string | null;
  /** Token icon URL (from token_metadata), if known. */
  icon: string | null;
  /** Pool TVL in XRP — both sides combined (XRP × 2 at equilibrium). */
  tvlXrp: number;
  /** XRPL trading fee in 1/100,000 units (1000 = 1%). */
  tradingFee: number;
}

export interface AMMListPage {
  /** Pools in this page, ordered by TVL DESC. */
  pools: AMMListItem[];
  /** Total measurable pools (rows with tvl_xrp > 0). NOT total amm_pools rows
   *  — token/token pools without an XRP anchor are unrankable and excluded. */
  total: number;
  /** True if more pages exist after this one. */
  hasMore: boolean;
}

/** Hard ceiling on how far the AMM listing pages. Beyond this is dust
 *  ($1 TVL ranges) and the SSR/JSON payload starts mattering. Easy to lift. */
const AMM_LISTING_MAX = 1000;

const ammListingCache = new LRUCache<AMMListPage>(20, 5 * 60 * 1000);

/**
 * Paginated AMM pool listing — for the /markets AMMs tab.
 *
 * Reads `amm_pools` (cached TVL refreshed by the AmmPoolTvlRefresher
 * timer ~every 10min) and joins token_metadata for display names +
 * icons in a single query. Five-minute in-memory LRU keyed on
 * `(offset, limit)` so back-to-back page loads don't hammer PG.
 *
 * Pagination contract mirrors `getTokenList`: caller asks for a window
 * starting at `offset`, server returns up to `limit` rows + the total
 * count (so the client can render "X of Y" and know when to hide the
 * "View More" button). Offsets past `AMM_LISTING_MAX` return empty
 * pools + `hasMore: false`.
 *
 * No XRPL WS calls. No ClickHouse calls.
 */
export async function getAMMListingForTable(
  offset = 0,
  limit = 100,
): Promise<AMMListPage> {
  // Clamp the page window to the hard ceiling. Past the ceiling we return
  // an empty page rather than a 4xx — the caller is doing legitimate
  // paging and we just hit the end.
  const safeOffset = Math.max(0, offset);
  if (safeOffset >= AMM_LISTING_MAX) {
    const totalRow = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM amm_pools
      WHERE tvl_xrp IS NOT NULL AND tvl_xrp > 0
    `);
    return {
      pools: [],
      total: Math.min(Number(totalRow[0]?.count ?? 0), AMM_LISTING_MAX),
      hasMore: false,
    };
  }
  const safeLimit = Math.min(limit, AMM_LISTING_MAX - safeOffset);

  const cacheKey = `amm-listing:${safeOffset}:${safeLimit}`;
  const cached = ammListingCache.get(cacheKey);
  if (cached) return cached;

  // Row fetch + total count run in parallel — the count doesn't depend on
  // which page we asked for, so PG can handle them concurrently.
  const [rows, [countRow]] = await Promise.all([
    db.execute<{
      account: string;
      asset1_currency: string;
      asset1_issuer: string | null;
      asset2_currency: string;
      asset2_issuer: string | null;
      trading_fee: number | null;
      tvl_xrp: string | null;
      issuer_name: string | null;
      icon: string | null;
    }>(sql`
      SELECT p.account,
             p.asset1_currency, p.asset1_issuer,
             p.asset2_currency, p.asset2_issuer,
             p.trading_fee,
             p.tvl_xrp::text AS tvl_xrp,
             tm.issuer_name,
             tm.icon
      FROM amm_pools p
      LEFT JOIN token_metadata tm
             ON tm.issuer = CASE WHEN p.asset1_currency = 'XRP' THEN p.asset2_issuer ELSE p.asset1_issuer END
            AND tm.currency = CASE WHEN p.asset1_currency = 'XRP' THEN p.asset2_currency ELSE p.asset1_currency END
      WHERE p.tvl_xrp IS NOT NULL
        AND p.tvl_xrp > 0
      ORDER BY p.tvl_xrp DESC
      LIMIT ${safeLimit}
      OFFSET ${safeOffset}
    `),
    db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM amm_pools
      WHERE tvl_xrp IS NOT NULL AND tvl_xrp > 0
    `),
  ]);

  const pools: AMMListItem[] = rows.map((row) => {
    // Whichever side isn't XRP is the "token" side for display.
    const tokenIsAsset2 = row.asset1_currency === "XRP";
    const tokenCurrency = tokenIsAsset2 ? row.asset2_currency : row.asset1_currency;
    const tokenIssuer = tokenIsAsset2 ? row.asset2_issuer : row.asset1_issuer;
    return {
      account: row.account,
      currency: tokenCurrency,
      currencyDisplay: decodeCurrency(tokenCurrency),
      issuer: tokenIssuer ?? "",
      issuerName: row.issuer_name ?? null,
      icon: row.icon ?? null,
      tvlXrp: Number(row.tvl_xrp ?? 0),
      tradingFee: row.trading_fee ?? 0,
    };
  });

  // Total reported to the client is capped at the ceiling so the count
  // text ("X of Y pools") doesn't promise rows the listing will never reach.
  const total = Math.min(Number(countRow?.count ?? pools.length), AMM_LISTING_MAX);
  const hasMore = safeOffset + pools.length < total;

  const result: AMMListPage = { pools, total, hasMore };
  ammListingCache.set(cacheKey, result);
  return result;
}

// Re-export DROPS_PER_XRP for anyone who was importing it from here.
export { DROPS_PER_XRP };
