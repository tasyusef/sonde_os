/**
 * Network & wallet analytics queries: Payment Corridors, Top Traders,
 * Active Wallets, Network Growth, Token Velocity.
 *
 * Migrated from Postgres aggregation tables to ClickHouse materialized views.
 * `token_metadata` still lives in Postgres for display names; total supply
 * comes from the CH `token_holder_snapshots` table (also migrated 2026-04-28).
 */

import "server-only";
import { inArray, and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tokenMetadata } from "@/db/schema";
import * as ch from "../clickhouse-client";
import { decodeCurrency } from "../xrpl-helpers";
import type {
  CorridorEntry,
  CorridorStats,
  TopTraderEntry,
  ActiveWalletsPoint,
  ActiveWalletsTotal,
  NetworkGrowthData,
  TokenVelocityEntry,
} from "@/types/analytics";
import { analyticsCache, type Period } from "./core";

/* ------------------------------------------------------------------ */
/*  Period helpers                                                       */
/* ------------------------------------------------------------------ */

/** Days for a non-7d analytics Period. Returns null for "all". */
function periodToDays(period: Period): number | null {
  switch (period) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "all":
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Payment Corridors                                                   */
/* ------------------------------------------------------------------ */

export async function getPaymentCorridors(
  period: "24h" | "7d" | "30d" = "7d",
  limit = 15,
): Promise<CorridorEntry[]> {
  const cacheKey = `corridors:${period}:${limit}`;
  const cached = analyticsCache.get(cacheKey) as CorridorEntry[] | undefined;
  if (cached) return cached;

  /* Aliases must NOT shadow source column names. CH's ORDER BY resolution
   * prefers the SELECT alias over the source column when both exist —
   * `ORDER BY sum(xrp_volume_drops)` with a String alias of the same name
   * would try `sum(<String>)` and fail with "Illegal type String of
   * argument for aggregate function sum." The String cast is needed because
   * Int64 sums can exceed JS Number safe range; the rename to
   * `payment_count` / `volume_drops` keeps both correctness and JS-side
   * precision. */
  type RawRow = {
    src_currency: string;
    src_issuer: string;
    dst_currency: string;
    dst_issuer: string;
    payment_count: number;
    volume_drops: string;
  };

  let rows: RawRow[];

  if (period === "24h") {
    rows = await ch.query<RawRow>(
      `SELECT src_currency,
              src_issuer,
              dst_currency,
              dst_issuer,
              toUInt64(sum(count)) AS payment_count,
              toString(toInt64(sum(xrp_volume_drops))) AS volume_drops
       FROM mv_payment_corridor_hourly
       WHERE hour >= now() - INTERVAL 24 HOUR
       GROUP BY src_currency, src_issuer, dst_currency, dst_issuer
       ORDER BY sum(xrp_volume_drops) DESC
       LIMIT {lim:UInt32}`,
      { lim: limit },
    );
  } else {
    const days = period === "7d" ? 7 : 30;
    rows = await ch.query<RawRow>(
      `SELECT src_currency,
              src_issuer,
              dst_currency,
              dst_issuer,
              toUInt64(sum(count)) AS payment_count,
              toString(toInt64(sum(xrp_volume_drops))) AS volume_drops
       FROM mv_payment_corridor_daily
       WHERE day >= today() - {days:UInt32}
       GROUP BY src_currency, src_issuer, dst_currency, dst_issuer
       ORDER BY sum(xrp_volume_drops) DESC
       LIMIT {lim:UInt32}`,
      { days, lim: limit },
    );
  }

  // Resolve currency names from token_metadata (still in Postgres)
  const issuers = new Set<string>();
  for (const r of rows) {
    if (r.src_issuer) issuers.add(r.src_issuer);
    if (r.dst_issuer) issuers.add(r.dst_issuer);
  }

  const nameMap = new Map<string, string>();
  if (issuers.size > 0) {
    const metaRows = await db
      .select({
        currency: tokenMetadata.currency,
        issuer: tokenMetadata.issuer,
        issuerName: tokenMetadata.issuerName,
      })
      .from(tokenMetadata)
      .where(inArray(tokenMetadata.issuer, Array.from(issuers)));

    for (const m of metaRows) {
      if (m.issuerName) nameMap.set(`${m.currency}:${m.issuer}`, m.issuerName);
    }
  }

  const corridors: CorridorEntry[] = rows.map((r) => ({
    srcCurrency: decodeCurrency(r.src_currency),
    srcName: r.src_issuer ? (nameMap.get(`${r.src_currency}:${r.src_issuer}`) ?? null) : null,
    dstCurrency: decodeCurrency(r.dst_currency),
    dstName: r.dst_issuer ? (nameMap.get(`${r.dst_currency}:${r.dst_issuer}`) ?? null) : null,
    count: Number(r.payment_count),
    xrpVolume: Number(r.volume_drops) / 1_000_000,
  }));

  analyticsCache.set(cacheKey, corridors);
  return corridors;
}

export async function getCorridorStats(
  period: "24h" | "7d" | "30d" = "7d",
): Promise<CorridorStats> {
  const cacheKey = `corridor-stats:${period}`;
  const cached = analyticsCache.get(cacheKey) as CorridorStats | undefined;
  if (cached) return cached;

  type StatsRow = {
    total_corridors: number;
    total_payments: number;
    total_xrp_volume_drops: string;
  };

  let row: StatsRow;

  if (period === "24h") {
    const [r] = await ch.query<StatsRow>(
      `SELECT toUInt64(uniqExact((src_currency, src_issuer, dst_currency, dst_issuer))) AS total_corridors,
              toUInt64(sum(count)) AS total_payments,
              toString(toInt64(sum(xrp_volume_drops))) AS total_xrp_volume_drops
       FROM mv_payment_corridor_hourly
       WHERE hour >= now() - INTERVAL 24 HOUR`,
    );
    row = r ?? { total_corridors: 0, total_payments: 0, total_xrp_volume_drops: "0" };
  } else {
    const days = period === "7d" ? 7 : 30;
    const [r] = await ch.query<StatsRow>(
      `SELECT toUInt64(uniqExact((src_currency, src_issuer, dst_currency, dst_issuer))) AS total_corridors,
              toUInt64(sum(count)) AS total_payments,
              toString(toInt64(sum(xrp_volume_drops))) AS total_xrp_volume_drops
       FROM mv_payment_corridor_daily
       WHERE day >= today() - {days:UInt32}`,
      { days },
    );
    row = r ?? { total_corridors: 0, total_payments: 0, total_xrp_volume_drops: "0" };
  }

  const result: CorridorStats = {
    totalCorridors: Number(row.total_corridors) ?? 0,
    totalPayments: Number(row.total_payments) ?? 0,
    totalXrpVolume: Number(row.total_xrp_volume_drops) / 1_000_000,
  };

  analyticsCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Top Traders                                                        */
/* ------------------------------------------------------------------ */

type TraderMode = "volume" | "profit";
type TraderPeriod = "24h" | "7d" | "30d";

export async function getTopTraders(
  mode: TraderMode = "volume",
  period: TraderPeriod = "24h",
  limit = 10,
): Promise<TopTraderEntry[]> {
  const cacheKey = `top-traders:${mode}:${period}:${limit}`;
  const cached = analyticsCache.get(cacheKey) as TopTraderEntry[] | undefined;
  if (cached) return cached;

  // Volume mode: rank by total trade volume per wallet using the
  // pre-aggregated MV (fast). Profit mode: rank by net XRP cash flow
  // per wallet using dex_trades directly — the MV
  // mv_wallet_trade_volume_hourly intentionally collapses buy/sell
  // direction into one absolute total, so we can't derive profit
  // from it. Querying the raw table costs a partition-pruned scan
  // but lets us produce real ranked-by-profit results, which the
  // previous "show profit of the top-by-volume traders" behavior
  // didn't (everyone's netProfitXrp was reported as 0).
  //
  // Convention for the profit query (matches the buy/sell logic in
  // smart-money.ts → computeWAVGForWallet):
  //   - dex_trades stores XRP-paired fills with one side (base or
  //     quote) being XRP. The ingester normalizes rows so the TAKER
  //     always pays XRP and the MAKER always receives XRP. So for
  //     every XRP-paired trade:
  //       taker's XRP delta = -xrp_volume_drops
  //       maker's XRP delta = +xrp_volume_drops
  //   - IOU↔IOU trades are skipped (no XRP cash flow to attribute).
  //   - Net profit ≈ net XRP cash flow over the window — exact for
  //     wallets that flatten back to zero inventory in the window;
  //     for wallets still holding inventory at window-end it's a
  //     "realized so far" view, which matches what users expect
  //     from a 24h/7d/30d trader leaderboard.

  if (mode === "volume") {
    type VolRow = {
      wallet: string;
      trade_count: number;
      volume_drops: string;
    };

    let rawRows: VolRow[];

    if (period === "24h") {
      rawRows = await ch.query<VolRow>(
        `SELECT wallet,
                toUInt64(sum(trade_count)) AS trade_count,
                toString(toInt64(sum(xrp_volume_drops))) AS volume_drops
         FROM mv_wallet_trade_volume_hourly
         WHERE hour >= now() - INTERVAL 24 HOUR
         GROUP BY wallet
         ORDER BY sum(xrp_volume_drops) DESC
         LIMIT {lim:UInt32}`,
        { lim: limit },
      );
    } else {
      const days = period === "7d" ? 7 : 30;
      rawRows = await ch.query<VolRow>(
        `SELECT wallet,
                toUInt64(sum(trade_count)) AS trade_count,
                toString(toInt64(sum(xrp_volume_drops))) AS volume_drops
         FROM mv_wallet_trade_volume_hourly
         WHERE hour >= today() - {days:UInt32}
         GROUP BY wallet
         ORDER BY sum(xrp_volume_drops) DESC
         LIMIT {lim:UInt32}`,
        { days, lim: limit },
      );
    }

    const entries: TopTraderEntry[] = rawRows.map((r) => {
      const totalDrops = Number(r.volume_drops);
      return {
        address: r.wallet,
        totalVolumeXrp: totalDrops / 1_000_000,
        buyVolumeXrp: 0,
        sellVolumeXrp: 0,
        netProfitXrp: 0,
        tradeCount: Number(r.trade_count) ?? 0,
      };
    });

    analyticsCache.set(cacheKey, entries);
    return entries;
  }

  // Profit mode — query dex_trades directly with signed XRP delta
  // per wallet. UNION ALL emits one row per (trade, side); the outer
  // GROUP BY collapses to one row per wallet with the net + abs sums.
  type ProfitRow = {
    wallet: string;
    net_drops: string;
    volume_drops: string;
    trade_count: number;
  };

  const periodClause =
    period === "24h"
      ? "timestamp >= now() - INTERVAL 24 HOUR"
      : `timestamp >= today() - ${period === "7d" ? 7 : 30}`;

  const xrpPairFilter =
    "(base_currency = 'XRP' AND base_issuer = '') OR (quote_currency = 'XRP' AND quote_issuer = '')";

  const profitRows = await ch.query<ProfitRow>(
    `SELECT wallet,
            toString(toInt64(sum(xrp_delta))) AS net_drops,
            toString(toInt64(sum(abs_xrp))) AS volume_drops,
            toUInt64(count()) AS trade_count
     FROM (
       SELECT taker AS wallet,
              -xrp_volume_drops AS xrp_delta,
              xrp_volume_drops AS abs_xrp
       FROM dex_trades
       WHERE ${periodClause}
         AND taker != ''
         AND xrp_volume_drops > 0
         AND (${xrpPairFilter})
       UNION ALL
       SELECT maker AS wallet,
              toInt64(xrp_volume_drops) AS xrp_delta,
              xrp_volume_drops AS abs_xrp
       FROM dex_trades
       WHERE ${periodClause}
         AND maker != ''
         AND xrp_volume_drops > 0
         AND (${xrpPairFilter})
     )
     GROUP BY wallet
     ORDER BY sum(xrp_delta) DESC
     LIMIT {lim:UInt32}`,
    { lim: limit },
  );

  const entries: TopTraderEntry[] = profitRows.map((r) => {
    const netDrops = Number(r.net_drops);
    const volDrops = Number(r.volume_drops);
    return {
      address: r.wallet,
      totalVolumeXrp: volDrops / 1_000_000,
      buyVolumeXrp: 0,
      sellVolumeXrp: 0,
      netProfitXrp: netDrops / 1_000_000,
      tradeCount: Number(r.trade_count) ?? 0,
    };
  });

  analyticsCache.set(cacheKey, entries);
  return entries;
}

/* ------------------------------------------------------------------ */
/*  Active Wallets                                                      */
/* ------------------------------------------------------------------ */

export async function getActiveWalletsTimeSeries(
  period: Period = "7d",
): Promise<ActiveWalletsPoint[]> {
  const cacheKey = `active-wallets-ts:${period}`;
  const cached = analyticsCache.get(cacheKey) as ActiveWalletsPoint[] | undefined;
  if (cached) return cached;

  let points: ActiveWalletsPoint[];

  if (period === "7d") {
    const rows = await ch.query<{
      bucket: string;
      unique_wallets: number;
      total_trades: number;
    }>(
      `SELECT toString(hour) AS bucket,
              toUInt64(uniqExact(wallet)) AS unique_wallets,
              toUInt64(sum(trade_count)) AS total_trades
       FROM mv_wallet_trade_volume_hourly
       WHERE hour >= now() - INTERVAL 7 DAY
       GROUP BY hour
       ORDER BY hour`,
    );
    points = rows.map((r) => ({
      timestamp: new Date(r.bucket).getTime(),
      uniqueWallets: Number(r.unique_wallets) ?? 0,
      totalTrades: Number(r.total_trades) ?? 0,
    }));
  } else {
    const days = periodToDays(period);
    const whereClause = days != null
      ? `WHERE hour >= today() - {days:UInt32}`
      : "";

    const rows = await ch.query<{
      bucket: string;
      unique_wallets: number;
      total_trades: number;
    }>(
      `SELECT toString(toDate(hour)) AS bucket,
              toUInt64(uniqExact(wallet)) AS unique_wallets,
              toUInt64(sum(trade_count)) AS total_trades
       FROM mv_wallet_trade_volume_hourly
       ${whereClause}
       GROUP BY bucket
       ORDER BY bucket`,
      days != null ? { days } : undefined,
    );
    points = rows.map((r) => ({
      timestamp: new Date(r.bucket).getTime(),
      uniqueWallets: Number(r.unique_wallets) ?? 0,
      totalTrades: Number(r.total_trades) ?? 0,
    }));
  }

  analyticsCache.set(cacheKey, points);
  return points;
}

export async function getActiveWalletsTotal(
  period: Period = "7d",
): Promise<ActiveWalletsTotal> {
  const cacheKey = `active-wallets-total:${period}`;
  const cached = analyticsCache.get(cacheKey) as ActiveWalletsTotal | undefined;
  if (cached) return cached;

  let uniqueWallets: number;
  let totalTrades: number;

  if (period === "7d") {
    const [row] = await ch.query<{
      unique_wallets: number;
      total_trades: number;
    }>(
      `SELECT toUInt64(uniqExact(wallet)) AS unique_wallets,
              toUInt64(sum(trade_count)) AS total_trades
       FROM mv_wallet_trade_volume_hourly
       WHERE hour >= now() - INTERVAL 7 DAY`,
    );
    uniqueWallets = Number(row?.unique_wallets) ?? 0;
    totalTrades = Number(row?.total_trades) ?? 0;
  } else {
    const days = periodToDays(period);
    const whereClause = days != null
      ? `WHERE hour >= today() - {days:UInt32}`
      : "";

    const [row] = await ch.query<{
      unique_wallets: number;
      total_trades: number;
    }>(
      `SELECT toUInt64(uniqExact(wallet)) AS unique_wallets,
              toUInt64(sum(trade_count)) AS total_trades
       FROM mv_wallet_trade_volume_hourly
       ${whereClause}`,
      days != null ? { days } : undefined,
    );
    uniqueWallets = Number(row?.unique_wallets) ?? 0;
    totalTrades = Number(row?.total_trades) ?? 0;
  }

  const result: ActiveWalletsTotal = {
    periodUniqueWallets: uniqueWallets,
    periodTotalTrades: totalTrades,
  };

  analyticsCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Network Growth (period-over-period comparison)                      */
/* ------------------------------------------------------------------ */

type GrowthPeriod = "7d" | "30d" | "90d";

export async function getNetworkGrowthStats(
  period: GrowthPeriod = "7d",
): Promise<NetworkGrowthData> {
  const cacheKey = `network-growth:${period}`;
  const cached = analyticsCache.get(cacheKey) as NetworkGrowthData | undefined;
  if (cached) return cached;

  const periodDays =
    period === "7d" ? 7
    : period === "30d" ? 30
    : 90;

  // All eight metrics in parallel, all backed by ClickHouse MVs.
  const [
    currentTraders,
    previousTraders,
    currentTrustSets,
    previousTrustSets,
    currentTokenPairs,
    previousTokenPairs,
    currentTxs,
    previousTxs,
  ] = await Promise.all([
    // Active traders — current
    ch.query<{ cnt: number }>(
      `SELECT toUInt64(uniqExact(wallet)) AS cnt
       FROM mv_wallet_trade_volume_hourly
       WHERE hour >= now() - INTERVAL {days:UInt32} DAY`,
      { days: periodDays },
    ).then((r) => Number(r[0]?.cnt) ?? 0),
    // Active traders — previous
    ch.query<{ cnt: number }>(
      `SELECT toUInt64(uniqExact(wallet)) AS cnt
       FROM mv_wallet_trade_volume_hourly
       WHERE hour >= now() - INTERVAL {prevDays:UInt32} DAY
         AND hour < now() - INTERVAL {days:UInt32} DAY`,
      { days: periodDays, prevDays: periodDays * 2 },
    ).then((r) => Number(r[0]?.cnt) ?? 0),
    // TrustSet ops — current
    ch.query<{ cnt: number }>(
      `SELECT toUInt64(sum(count)) AS cnt
       FROM mv_hourly_tx_volume
       WHERE hour >= now() - INTERVAL {days:UInt32} DAY
         AND tx_type = 'TrustSet'`,
      { days: periodDays },
    ).then((r) => Number(r[0]?.cnt) ?? 0),
    // TrustSet ops — previous
    ch.query<{ cnt: number }>(
      `SELECT toUInt64(sum(count)) AS cnt
       FROM mv_hourly_tx_volume
       WHERE hour >= now() - INTERVAL {prevDays:UInt32} DAY
         AND hour < now() - INTERVAL {days:UInt32} DAY
         AND tx_type = 'TrustSet'`,
      { days: periodDays, prevDays: periodDays * 2 },
    ).then((r) => Number(r[0]?.cnt) ?? 0),
    // Unique token pairs — current
    // Note: `(currency, issuer)` in PG → `(base_currency, base_issuer)` in CH.
    // This counts unique base tokens that traded, matching the original semantics.
    ch.query<{ cnt: number }>(
      `SELECT toUInt64(uniqExact((base_currency, base_issuer))) AS cnt
       FROM mv_token_volume_hourly
       WHERE hour >= now() - INTERVAL {days:UInt32} DAY`,
      { days: periodDays },
    ).then((r) => Number(r[0]?.cnt) ?? 0),
    // Unique token pairs — previous
    ch.query<{ cnt: number }>(
      `SELECT toUInt64(uniqExact((base_currency, base_issuer))) AS cnt
       FROM mv_token_volume_hourly
       WHERE hour >= now() - INTERVAL {prevDays:UInt32} DAY
         AND hour < now() - INTERVAL {days:UInt32} DAY`,
      { days: periodDays, prevDays: periodDays * 2 },
    ).then((r) => Number(r[0]?.cnt) ?? 0),
    // Total txs — current
    ch.query<{ cnt: number }>(
      `SELECT toUInt64(sum(count)) AS cnt
       FROM mv_hourly_tx_volume
       WHERE hour >= now() - INTERVAL {days:UInt32} DAY`,
      { days: periodDays },
    ).then((r) => Number(r[0]?.cnt) ?? 0),
    // Total txs — previous
    ch.query<{ cnt: number }>(
      `SELECT toUInt64(sum(count)) AS cnt
       FROM mv_hourly_tx_volume
       WHERE hour >= now() - INTERVAL {prevDays:UInt32} DAY
         AND hour < now() - INTERVAL {days:UInt32} DAY`,
      { days: periodDays, prevDays: periodDays * 2 },
    ).then((r) => Number(r[0]?.cnt) ?? 0),
  ]);

  function changePercent(current: number, previous: number): number | null {
    if (previous === 0) return null;
    return ((current - previous) / previous) * 100;
  }

  const result: NetworkGrowthData = {
    metrics: [
      {
        label: "Active Traders",
        current: currentTraders,
        previous: previousTraders,
        changePercent: changePercent(currentTraders, previousTraders),
      },
      {
        label: "Trust Lines",
        current: currentTrustSets,
        previous: previousTrustSets,
        changePercent: changePercent(currentTrustSets, previousTrustSets),
      },
      {
        label: "Token Pairs",
        current: currentTokenPairs,
        previous: previousTokenPairs,
        changePercent: changePercent(currentTokenPairs, previousTokenPairs),
      },
      {
        label: "Transactions",
        current: currentTxs,
        previous: previousTxs,
        changePercent: changePercent(currentTxs, previousTxs),
      },
    ],
  };

  analyticsCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Token Velocity                                                      */
/* ------------------------------------------------------------------ */

export async function getTokenVelocity(
  period: GrowthPeriod = "7d",
  limit = 10,
): Promise<TokenVelocityEntry[]> {
  const cacheKey = `token-velocity:${period}:${limit}`;
  const cached = analyticsCache.get(cacheKey) as TokenVelocityEntry[] | undefined;
  if (cached) return cached;

  const periodDays =
    period === "7d" ? 7
    : period === "30d" ? 30
    : 90;

  // Get top tokens by volume from CH. base_currency != 'XRP' filters out XRP itself.
  const volumeRows = await ch.query<{
    currency: string;
    issuer: string;
    vol_drops: string;
    trades: number;
  }>(
    `SELECT base_currency AS currency,
            base_issuer AS issuer,
            toString(toInt64(sum(xrp_volume_drops))) AS vol_drops,
            toUInt64(sum(trade_count)) AS trades
     FROM mv_token_volume_hourly
     WHERE hour >= now() - INTERVAL {days:UInt32} DAY
       AND base_currency != 'XRP'
     GROUP BY base_currency, base_issuer
     ORDER BY sum(xrp_volume_drops) DESC
     LIMIT 50`,
    { days: periodDays },
  );

  // For each top token, fetch supply from CH token_holder_snapshots and
  // metadata from PG token_metadata.
  const entries: TokenVelocityEntry[] = [];

  for (const row of volumeRows) {
    const currency = row.currency;
    const issuer = row.issuer;
    const volDrops = Number(row.vol_drops);
    const volumeXrp = volDrops / 1_000_000;

    if (volumeXrp <= 0) continue;

    // Get latest supply snapshot from CH
    const supplyRows = await ch.query<{ total_supply: number }>(
      `SELECT total_supply
       FROM token_holder_snapshots
       WHERE currency = {currency:String} AND issuer = {issuer:String}
       ORDER BY snapshot_time DESC
       LIMIT 1`,
      { currency, issuer },
    );

    const totalSupply = supplyRows.length > 0 ? supplyRows[0].total_supply : 0;

    if (!Number.isFinite(totalSupply) || totalSupply <= 0) continue;

    const velocity = volumeXrp / totalSupply;

    // Get metadata
    const metaRows = await db
      .select({
        name: tokenMetadata.name,
        icon: tokenMetadata.icon,
        issuerName: tokenMetadata.issuerName,
      })
      .from(tokenMetadata)
      .where(
        and(eq(tokenMetadata.currency, currency), eq(tokenMetadata.issuer, issuer)),
      )
      .limit(1);

    const meta = metaRows[0];

    entries.push({
      currency,
      currencyDisplay: currency.length === 40 ? decodeCurrency(currency) : currency,
      issuer,
      issuerName: meta?.issuerName ?? meta?.name ?? null,
      icon: meta?.icon ?? null,
      velocity,
      volumeXrp,
      totalSupply,
    });

    if (entries.length >= limit) break;
  }

  // Sort by velocity descending
  entries.sort((a, b) => b.velocity - a.velocity);

  analyticsCache.set(cacheKey, entries);
  return entries;
}
