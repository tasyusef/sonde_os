/**
 * Volume & activity analytics queries: Fee Burn, Tx Volume, DEX Volume, NFT Activity.
 *
 * Migrated from Postgres aggregation tables to ClickHouse materialized views.
 * The CH MVs are real-time — no separate "completed daily rollups + unrolled hourly"
 * union is needed. Daily rollups are derived by `toDate(hour)` over the hourly MV
 * (or via `mv_dex_pair_daily` / `mv_nft_volume_daily` where available).
 */

import "server-only";
import * as ch from "../clickhouse-client";
import { getTypeFamily } from "../xrpl-helpers";
import type {
  FeeBurnPoint,
  TxVolumePoint,
  DexVolumePoint,
  DexVolumeTotal,
  NFTActivityPoint,
  NFTActivityTotal,
} from "@/types/analytics";
import { analyticsCache, dropsToXrpNum, type Period } from "./core";

/* ------------------------------------------------------------------ */
/*  Period helpers (ClickHouse-native time math)                        */
/* ------------------------------------------------------------------ */

/** Days for a non-7d period. Returns null for "all". */
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
/*  Fee Burn                                                            */
/* ------------------------------------------------------------------ */

export async function getFeeBurnTimeSeries(
  period: Period = "7d",
): Promise<FeeBurnPoint[]> {
  const cacheKey = `fee-burn-ts:${period}`;
  const cached = analyticsCache.get(cacheKey) as FeeBurnPoint[] | undefined;
  if (cached) return cached;

  let points: FeeBurnPoint[];

  if (period === "7d") {
    // Hourly granularity for 7d.
    const rows = await ch.query<{
      bucket: string;
      tx_count: number;
      total_burn_drops: string;
    }>(
      `SELECT toString(hour) AS bucket,
              toUInt64(sum(tx_count)) AS tx_count,
              toString(toInt64(sum(total_burn_drops))) AS total_burn_drops
       FROM mv_fee_burn_hourly
       WHERE hour >= now() - INTERVAL 7 DAY
       GROUP BY hour
       ORDER BY hour`,
    );

    points = rows.map((r) => ({
      timestamp: new Date(r.bucket).getTime(),
      txCount: Number(r.tx_count) ?? 0,
      burnDrops: r.total_burn_drops ?? "0",
    }));
  } else {
    // Daily granularity for 30d/90d/all — derived from the hourly MV.
    const days = periodToDays(period);
    const whereClause = days != null
      ? `WHERE hour >= today() - {days:UInt32}`
      : "";

    const rows = await ch.query<{
      bucket: string;
      tx_count: number;
      total_burn_drops: string;
    }>(
      `SELECT toString(toDate(hour)) AS bucket,
              toUInt64(sum(tx_count)) AS tx_count,
              toString(toInt64(sum(total_burn_drops))) AS total_burn_drops
       FROM mv_fee_burn_hourly
       ${whereClause}
       GROUP BY bucket
       ORDER BY bucket`,
      days != null ? { days } : undefined,
    );

    points = rows.map((r) => ({
      timestamp: new Date(r.bucket).getTime(),
      txCount: Number(r.tx_count) ?? 0,
      burnDrops: r.total_burn_drops ?? "0",
    }));
  }

  analyticsCache.set(cacheKey, points);
  return points;
}

export async function getFeeBurnTotal(
  period: Period = "7d",
): Promise<{ totalDrops: string; totalXrp: number; periodDrops: string; periodXrp: number }> {
  const cacheKey = `fee-burn-total:${period}`;
  const cached = analyticsCache.get(cacheKey) as
    | { totalDrops: string; totalXrp: number; periodDrops: string; periodXrp: number }
    | undefined;
  if (cached) return cached;

  // All-time total
  const [allTimeRow] = await ch.query<{ total: string }>(
    `SELECT toString(toInt64(sum(total_burn_drops))) AS total
     FROM mv_fee_burn_hourly`,
  );

  const totalDrops = allTimeRow?.total ?? "0";
  const totalDropsBig = BigInt(totalDrops);
  const totalXrp = dropsToXrpNum(totalDropsBig);

  // Period total
  let periodDrops: string;

  if (period === "7d") {
    const [row] = await ch.query<{ total: string }>(
      `SELECT toString(toInt64(sum(total_burn_drops))) AS total
       FROM mv_fee_burn_hourly
       WHERE hour >= now() - INTERVAL 7 DAY`,
    );
    periodDrops = row?.total ?? "0";
  } else {
    const days = periodToDays(period);
    if (days == null) {
      // "all" — period total == all-time total
      periodDrops = totalDrops;
    } else {
      const [row] = await ch.query<{ total: string }>(
        `SELECT toString(toInt64(sum(total_burn_drops))) AS total
         FROM mv_fee_burn_hourly
         WHERE hour >= today() - {days:UInt32}`,
        { days },
      );
      periodDrops = row?.total ?? "0";
    }
  }

  const result = {
    totalDrops,
    totalXrp,
    periodDrops,
    periodXrp: dropsToXrpNum(periodDrops),
  };

  analyticsCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Tx Volume                                                          */
/* ------------------------------------------------------------------ */

export async function getTxVolumeTimeSeries(
  period: Period = "7d",
): Promise<TxVolumePoint[]> {
  const cacheKey = `tx-vol-ts:${period}`;
  const cached = analyticsCache.get(cacheKey) as TxVolumePoint[] | undefined;
  if (cached) return cached;

  let rows: { timestamp: number; txType: string; count: number }[];

  if (period === "7d") {
    const dbRows = await ch.query<{
      bucket: string;
      tx_type: string;
      count: number;
    }>(
      `SELECT toString(hour) AS bucket,
              tx_type,
              toUInt64(sum(count)) AS count
       FROM mv_hourly_tx_volume
       WHERE hour >= now() - INTERVAL 7 DAY
       GROUP BY hour, tx_type
       ORDER BY hour`,
    );

    rows = dbRows.map((r) => ({
      timestamp: new Date(r.bucket).getTime(),
      txType: r.tx_type,
      count: Number(r.count) ?? 0,
    }));
  } else {
    const days = periodToDays(period);
    const whereClause = days != null
      ? `WHERE hour >= today() - {days:UInt32}`
      : "";

    const dbRows = await ch.query<{
      bucket: string;
      tx_type: string;
      count: number;
    }>(
      `SELECT toString(toDate(hour)) AS bucket,
              tx_type,
              toUInt64(sum(count)) AS count
       FROM mv_hourly_tx_volume
       ${whereClause}
       GROUP BY bucket, tx_type
       ORDER BY bucket`,
      days != null ? { days } : undefined,
    );

    rows = dbRows.map((r) => ({
      timestamp: new Date(r.bucket).getTime(),
      txType: r.tx_type,
      count: Number(r.count) ?? 0,
    }));
  }

  // Group by timestamp, aggregate by type family
  const grouped = new Map<number, Record<string, number>>();
  for (const row of rows) {
    const family = getTypeFamily(row.txType);
    if (!grouped.has(row.timestamp)) {
      grouped.set(row.timestamp, {});
    }
    const families = grouped.get(row.timestamp)!;
    families[family] = (families[family] ?? 0) + row.count;
  }

  const points: TxVolumePoint[] = [];
  for (const [timestamp, families] of grouped) {
    const total = Object.values(families).reduce((a, b) => a + b, 0);
    points.push({ timestamp, families, total });
  }

  points.sort((a, b) => a.timestamp - b.timestamp);
  analyticsCache.set(cacheKey, points);
  return points;
}

export async function getTxVolumeStats(
  period: Period = "7d",
): Promise<{ totalTxs: number; avgDaily: number }> {
  const cacheKey = `tx-vol-stats:${period}`;
  const cached = analyticsCache.get(cacheKey) as { totalTxs: number; avgDaily: number } | undefined;
  if (cached) return cached;

  const timeSeries = await getTxVolumeTimeSeries(period);
  const totalTxs = timeSeries.reduce((sum, p) => sum + p.total, 0);
  // For 7d period, timeSeries contains hourly points — divide by actual day count
  const isHourly = period === "7d";
  const days = Math.max(1, isHourly ? Math.ceil(timeSeries.length / 24) : timeSeries.length);
  const avgDaily = Math.round(totalTxs / days);

  const result = { totalTxs, avgDaily };
  analyticsCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  DEX Volume (from token_volume MVs)                                 */
/* ------------------------------------------------------------------ */

export async function getDexVolumeTimeSeries(
  period: Period = "7d",
): Promise<DexVolumePoint[]> {
  const cacheKey = `dex-vol-ts:${period}`;
  const cached = analyticsCache.get(cacheKey) as DexVolumePoint[] | undefined;
  if (cached) return cached;

  let points: DexVolumePoint[];

  if (period === "7d") {
    const rows = await ch.query<{
      bucket: string;
      xrp_volume_drops: string;
      trade_count: number;
    }>(
      `SELECT toString(hour) AS bucket,
              toString(toInt64(sum(xrp_volume_drops))) AS xrp_volume_drops,
              toUInt64(sum(trade_count)) AS trade_count
       FROM mv_token_volume_hourly
       WHERE hour >= now() - INTERVAL 7 DAY
       GROUP BY hour
       ORDER BY hour`,
    );
    points = rows.map((r) => ({
      timestamp: new Date(r.bucket).getTime(),
      xrpVolume: Number(r.xrp_volume_drops) / 1_000_000,
      tradeCount: Number(r.trade_count) ?? 0,
    }));
  } else {
    // Daily MV exists — use it directly.
    const days = periodToDays(period);
    const whereClause = days != null
      ? `WHERE day >= today() - {days:UInt32}`
      : "";

    const rows = await ch.query<{
      bucket: string;
      xrp_volume_drops: string;
      trade_count: number;
    }>(
      `SELECT toString(day) AS bucket,
              toString(toInt64(sum(xrp_volume_drops))) AS xrp_volume_drops,
              toUInt64(sum(trade_count)) AS trade_count
       FROM mv_dex_pair_daily
       ${whereClause}
       GROUP BY day
       ORDER BY day`,
      days != null ? { days } : undefined,
    );
    points = rows.map((r) => ({
      timestamp: new Date(r.bucket).getTime(),
      xrpVolume: Number(r.xrp_volume_drops) / 1_000_000,
      tradeCount: Number(r.trade_count) ?? 0,
    }));
  }

  analyticsCache.set(cacheKey, points);
  return points;
}

export async function getDexVolumeTotal(
  period: Period = "7d",
): Promise<DexVolumeTotal> {
  const cacheKey = `dex-vol-total:${period}`;
  const cached = analyticsCache.get(cacheKey) as DexVolumeTotal | undefined;
  if (cached) return cached;

  let xrpDrops: string;
  let tradeCount: number;

  if (period === "7d") {
    const [row] = await ch.query<{ total: string; trades: number }>(
      `SELECT toString(toInt64(sum(xrp_volume_drops))) AS total,
              toUInt64(sum(trade_count)) AS trades
       FROM mv_token_volume_hourly
       WHERE hour >= now() - INTERVAL 7 DAY`,
    );
    xrpDrops = row?.total ?? "0";
    tradeCount = Number(row?.trades) ?? 0;
  } else {
    const days = periodToDays(period);
    const whereClause = days != null
      ? `WHERE day >= today() - {days:UInt32}`
      : "";

    const [row] = await ch.query<{ total: string; trades: number }>(
      `SELECT toString(toInt64(sum(xrp_volume_drops))) AS total,
              toUInt64(sum(trade_count)) AS trades
       FROM mv_dex_pair_daily
       ${whereClause}`,
      days != null ? { days } : undefined,
    );
    xrpDrops = row?.total ?? "0";
    tradeCount = Number(row?.trades) ?? 0;
  }

  const result: DexVolumeTotal = {
    periodXrpVolume: Number(xrpDrops) / 1_000_000,
    periodTradeCount: tradeCount,
  };

  analyticsCache.set(cacheKey, result);
  return result;
}

/**
 * 7-day DEX volume in XRP with a period-over-period change percentage
 * (vs. the 7 days immediately prior). Used by the landing-page hero
 * stat strip alongside the NetworkGrowth metrics so all four numbers
 * share a single "7D" framing. Returns `null` for `changePercent` when
 * the previous window had zero volume (avoids divide-by-zero / Infinity).
 */
export async function getDexVolume7dChange(): Promise<{
  current: number;
  previous: number;
  changePercent: number | null;
}> {
  const cacheKey = "dex-vol-7d-change";
  const cached = analyticsCache.get(cacheKey) as
    | { current: number; previous: number; changePercent: number | null }
    | undefined;
  if (cached) return cached;

  // One round-trip — sum both windows in parallel via separate queries.
  // mv_token_volume_hourly covers ~14d easily; the previous-window
  // filter just shifts the lower bound back another 7d.
  const [currentRow, previousRow] = await Promise.all([
    ch.query<{ total: string }>(
      `SELECT toString(toInt64(sum(xrp_volume_drops))) AS total
       FROM mv_token_volume_hourly
       WHERE hour >= now() - INTERVAL 7 DAY`,
    ),
    ch.query<{ total: string }>(
      `SELECT toString(toInt64(sum(xrp_volume_drops))) AS total
       FROM mv_token_volume_hourly
       WHERE hour >= now() - INTERVAL 14 DAY
         AND hour <  now() - INTERVAL 7 DAY`,
    ),
  ]);

  const current = Number(currentRow[0]?.total ?? 0) / 1_000_000;
  const previous = Number(previousRow[0]?.total ?? 0) / 1_000_000;
  const changePercent =
    previous === 0 ? null : ((current - previous) / previous) * 100;

  const result = { current, previous, changePercent };
  analyticsCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  NFT Activity (from nft_volume MVs)                                 */
/* ------------------------------------------------------------------ */

export async function getNFTActivityTimeSeries(
  period: Period = "7d",
): Promise<NFTActivityPoint[]> {
  const cacheKey = `nft-act-ts:${period}`;
  const cached = analyticsCache.get(cacheKey) as NFTActivityPoint[] | undefined;
  if (cached) return cached;

  let points: NFTActivityPoint[];

  if (period === "7d") {
    const rows = await ch.query<{
      bucket: string;
      xrp_volume_drops: string;
      trade_count: number;
    }>(
      `SELECT toString(hour) AS bucket,
              toString(toInt64(sum(xrp_volume_drops))) AS xrp_volume_drops,
              toUInt64(sum(trade_count)) AS trade_count
       FROM mv_nft_volume_hourly
       WHERE hour >= now() - INTERVAL 7 DAY
       GROUP BY hour
       ORDER BY hour`,
    );
    points = rows.map((r) => ({
      timestamp: new Date(r.bucket).getTime(),
      xrpVolume: Number(r.xrp_volume_drops) / 1_000_000,
      tradeCount: Number(r.trade_count) ?? 0,
    }));
  } else {
    const days = periodToDays(period);
    const whereClause = days != null
      ? `WHERE day >= today() - {days:UInt32}`
      : "";

    const rows = await ch.query<{
      bucket: string;
      xrp_volume_drops: string;
      trade_count: number;
    }>(
      `SELECT toString(day) AS bucket,
              toString(toInt64(sum(xrp_volume_drops))) AS xrp_volume_drops,
              toUInt64(sum(trade_count)) AS trade_count
       FROM mv_nft_volume_daily
       ${whereClause}
       GROUP BY day
       ORDER BY day`,
      days != null ? { days } : undefined,
    );
    points = rows.map((r) => ({
      timestamp: new Date(r.bucket).getTime(),
      xrpVolume: Number(r.xrp_volume_drops) / 1_000_000,
      tradeCount: Number(r.trade_count) ?? 0,
    }));
  }

  analyticsCache.set(cacheKey, points);
  return points;
}

export async function getNFTActivityTotal(
  period: Period = "7d",
): Promise<NFTActivityTotal> {
  const cacheKey = `nft-act-total:${period}`;
  const cached = analyticsCache.get(cacheKey) as NFTActivityTotal | undefined;
  if (cached) return cached;

  let xrpDrops: string;
  let tradeCount: number;

  if (period === "7d") {
    const [row] = await ch.query<{ total: string; trades: number }>(
      `SELECT toString(toInt64(sum(xrp_volume_drops))) AS total,
              toUInt64(sum(trade_count)) AS trades
       FROM mv_nft_volume_hourly
       WHERE hour >= now() - INTERVAL 7 DAY`,
    );
    xrpDrops = row?.total ?? "0";
    tradeCount = Number(row?.trades) ?? 0;
  } else {
    const days = periodToDays(period);
    const whereClause = days != null
      ? `WHERE day >= today() - {days:UInt32}`
      : "";

    const [row] = await ch.query<{ total: string; trades: number }>(
      `SELECT toString(toInt64(sum(xrp_volume_drops))) AS total,
              toUInt64(sum(trade_count)) AS trades
       FROM mv_nft_volume_daily
       ${whereClause}`,
      days != null ? { days } : undefined,
    );
    xrpDrops = row?.total ?? "0";
    tradeCount = Number(row?.trades) ?? 0;
  }

  const result: NFTActivityTotal = {
    periodXrpVolume: Number(xrpDrops) / 1_000_000,
    periodTradeCount: tradeCount,
  };

  analyticsCache.set(cacheKey, result);
  return result;
}
