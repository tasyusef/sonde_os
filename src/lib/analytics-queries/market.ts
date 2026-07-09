/**
 * Market & token analytics queries: Top Token Movers, AMM Fee Revenue,
 * XRP Supply / Cumulative Burn.
 *
 * Migrated from Postgres aggregation tables to ClickHouse materialized views.
 * `token_metadata` (display names + icons) still lives in Postgres — we run
 * the aggregation in CH first, collect issuer keys, then fetch metadata from
 * PG in a separate query and merge in JS.
 */

import "server-only";
import { sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  tokenMetadata,
  ammPools,
} from "@/db/schema";
import * as ch from "../clickhouse-client";
import { decodeCurrency } from "../xrpl-helpers";
import type {
  TokenMoverEntry,
  AMMRevenuePoint,
  AMMRevenueTotal,
  AMMPoolRevenueSeries,
  XRPSupplyPoint,
  XRPSupplyTotal,
} from "@/types/analytics";
import { analyticsCache, type Period } from "./core";
import { getFeeBurnTimeSeries, getFeeBurnTotal } from "./volume";

/* ------------------------------------------------------------------ */
/*  Top Token Movers (volume comparison: current vs prior period)      */
/* ------------------------------------------------------------------ */

type MoverPeriod = "24h" | "7d" | "30d";

export async function getTopTokenMovers(
  period: MoverPeriod = "24h",
  limit = 8,
): Promise<TokenMoverEntry[]> {
  const cacheKey = `token-movers:${period}:${limit}`;
  const cached = analyticsCache.get(cacheKey) as TokenMoverEntry[] | undefined;
  if (cached) return cached;

  const periodHours =
    period === "24h" ? 24
    : period === "7d" ? 7 * 24
    : 30 * 24;

  // 24h uses the hourly MV; 7d/30d use the daily MV.
  // Both store base_currency/base_issuer and quote_currency/quote_issuer,
  // so we group by base_currency/base_issuer to "per-token" totals.
  const useHourly = period === "24h";
  const table = useHourly ? "mv_token_volume_hourly" : "mv_dex_pair_daily";
  const timeCol = useHourly ? "hour" : "day";
  const intervalUnit = useHourly ? "HOUR" : "DAY";
  const intervalSize = useHourly ? periodHours : periodHours / 24;

  type RawRow = {
    currency: string;
    issuer: string;
    vol_drops: string;
    trades: number;
    prev_vol_drops: string;
  };

  const rows = await ch.query<RawRow>(
    `WITH current_vol AS (
       SELECT base_currency AS currency,
              base_issuer AS issuer,
              toString(toInt64(sum(xrp_volume_drops))) AS vol_drops,
              toUInt64(sum(trade_count)) AS trades
       FROM ${table}
       WHERE ${timeCol} >= now() - INTERVAL {interval:UInt32} ${intervalUnit}
       GROUP BY base_currency, base_issuer
     ),
     previous_vol AS (
       SELECT base_currency AS currency,
              base_issuer AS issuer,
              toString(toInt64(sum(xrp_volume_drops))) AS vol_drops
       FROM ${table}
       WHERE ${timeCol} >= now() - INTERVAL {prevInterval:UInt32} ${intervalUnit}
         AND ${timeCol} < now() - INTERVAL {interval:UInt32} ${intervalUnit}
       GROUP BY base_currency, base_issuer
     )
     SELECT c.currency AS currency,
            c.issuer AS issuer,
            c.vol_drops AS vol_drops,
            c.trades AS trades,
            coalesce(p.vol_drops, '0') AS prev_vol_drops
     FROM current_vol c
     LEFT JOIN previous_vol p ON c.currency = p.currency AND c.issuer = p.issuer
     ORDER BY toInt64(c.vol_drops) DESC
     LIMIT {lim:UInt32}`,
    {
      interval: intervalSize,
      prevInterval: intervalSize * 2,
      lim: limit,
    },
  );

  const issuers = new Set<string>();
  for (const r of rows) {
    if (r.issuer) issuers.add(r.issuer);
  }

  // Resolve names + icons from token_metadata (still in Postgres)
  const metaMap = new Map<
    string,
    { issuerName: string | null; icon: string | null; currencyDisplay: string }
  >();
  if (issuers.size > 0) {
    const metaRows = await db
      .select({
        currency: tokenMetadata.currency,
        issuer: tokenMetadata.issuer,
        issuerName: tokenMetadata.issuerName,
        icon: tokenMetadata.icon,
      })
      .from(tokenMetadata)
      .where(inArray(tokenMetadata.issuer, Array.from(issuers)));

    for (const m of metaRows) {
      metaMap.set(`${m.currency}:${m.issuer}`, {
        issuerName: m.issuerName,
        icon: m.icon,
        currencyDisplay: decodeCurrency(m.currency),
      });
    }
  }

  const entries: TokenMoverEntry[] = rows.map((r) => {
    const currency = r.currency;
    const issuer = r.issuer;
    const currentVol = Number(r.vol_drops) / 1_000_000;
    const previousVol = Number(r.prev_vol_drops) / 1_000_000;
    const meta = metaMap.get(`${currency}:${issuer}`);

    let changePercent: number | null = null;
    if (previousVol > 0) {
      changePercent = ((currentVol - previousVol) / previousVol) * 100;
    }

    return {
      currency,
      currencyDisplay: meta?.currencyDisplay ?? decodeCurrency(currency),
      issuer,
      issuerName: meta?.issuerName ?? null,
      icon: meta?.icon ?? null,
      currentVolume: currentVol,
      previousVolume: previousVol,
      changePercent,
      tradeCount: Number(r.trades) ?? 0,
    };
  });

  analyticsCache.set(cacheKey, entries);
  return entries;
}

/* ------------------------------------------------------------------ */
/*  AMM Fee Revenue (estimated from token volume x trading fee)        */
/* ------------------------------------------------------------------ */

export async function getAMMFeeRevenue(
  period: Period = "7d",
): Promise<{ timeSeries: AMMRevenuePoint[]; total: AMMRevenueTotal; poolSeries: AMMPoolRevenueSeries[] }> {
  const cacheKey = `amm-rev:${period}`;
  const cached = analyticsCache.get(cacheKey) as
    | { timeSeries: AMMRevenuePoint[]; total: AMMRevenueTotal; poolSeries: AMMPoolRevenueSeries[] }
    | undefined;
  if (cached) return cached;

  // 1. Get AMM pool fee rates from PG (no live XRPL calls)
  const poolRows = await db
    .select({
      account: ammPools.account,
      asset2Currency: ammPools.asset2Currency,
      asset2Issuer: ammPools.asset2Issuer,
      tradingFee: ammPools.tradingFee,
    })
    .from(ammPools)
    .where(sql`${ammPools.tradingFee} IS NOT NULL`);

  if (poolRows.length === 0) {
    const empty = {
      timeSeries: [],
      total: { periodFeeXrp: 0, topEarners: [] },
      poolSeries: [],
    };
    analyticsCache.set(cacheKey, empty);
    return empty;
  }

  // Build a map: "decodedCurrency:issuer" -> tradingFee as decimal
  // XRPL trading_fee is in units of 1/100,000: value 1 = 0.001%, value 1000 = 1%
  const feeMap = new Map<string, number>();
  for (const pool of poolRows) {
    const decoded = decodeCurrency(pool.asset2Currency);
    const key = `${decoded}:${pool.asset2Issuer}`;
    feeMap.set(key, pool.tradingFee! / 100_000);
  }

  const ammIssuers = poolRows
    .map((p) => p.asset2Issuer)
    .filter((i): i is string => i !== null);
  if (ammIssuers.length === 0) {
    const empty = { timeSeries: [], total: { periodFeeXrp: 0, topEarners: [] }, poolSeries: [] };
    analyticsCache.set(cacheKey, empty);
    return empty;
  }

  // 2. Get token volume time series.
  //
  // We previously filtered server-side with `AND base_issuer IN
  // {issuers:Array(String)}` over the AMM issuer list. With ~1,200+
  // issuers that array becomes ~80KB of URL query string — clickhouse-client
  // sends params via GET, which gets rejected by Cloudflare's URL length
  // limit (~16KB) on the prod path (Railway → CF tunnel → CH). The
  // request fails with an empty 414 body and surfaces as a useless
  // empty Error from the CH client's parseError("") fallback.
  //
  // Filter in JS instead — `feeMap` is keyed by `${currency}:${issuer}`
  // so any row whose issuer isn't an AMM-paired one is dropped at the
  // `if (!feeRate) continue` check below. Pulls a few extra rows from
  // CH but fits well under any URL limit and runs identically against
  // local + prod paths.
  type VolumeRow = {
    bucket: string;
    currency: string;
    issuer: string;
    xrp_volume_drops: string;
  };

  let volumeRows: VolumeRow[];

  if (period === "7d") {
    volumeRows = await ch.query<VolumeRow>(
      `SELECT toString(hour) AS bucket,
              base_currency AS currency,
              base_issuer AS issuer,
              toString(toInt64(sum(xrp_volume_drops))) AS xrp_volume_drops
       FROM mv_token_volume_hourly
       WHERE hour >= now() - INTERVAL 7 DAY
       GROUP BY hour, base_currency, base_issuer
       ORDER BY hour`,
    );
  } else {
    const days = period === "30d" ? 30 : period === "90d" ? 90 : null;
    const whereClause = days != null
      ? `WHERE day >= today() - {days:UInt32}`
      : ``;

    volumeRows = await ch.query<VolumeRow>(
      `SELECT toString(day) AS bucket,
              base_currency AS currency,
              base_issuer AS issuer,
              toString(toInt64(sum(xrp_volume_drops))) AS xrp_volume_drops
       FROM mv_dex_pair_daily
       ${whereClause}
       GROUP BY day, base_currency, base_issuer
       ORDER BY day`,
      days != null ? { days } : undefined,
    );
  }

  // 3. Calculate estimated fees per time bucket
  const bucketFees = new Map<string, number>();
  const tokenFees = new Map<string, number>();

  // Resolve issuer names from token_metadata for top earners
  const issuerSet = new Set(ammIssuers);
  const nameMap = new Map<string, string>();
  if (issuerSet.size > 0) {
    const metaRows = await db
      .select({
        currency: tokenMetadata.currency,
        issuer: tokenMetadata.issuer,
        issuerName: tokenMetadata.issuerName,
      })
      .from(tokenMetadata)
      .where(inArray(tokenMetadata.issuer, Array.from(issuerSet)));
    for (const m of metaRows) {
      if (m.issuerName) nameMap.set(`${decodeCurrency(m.currency)}:${m.issuer}`, m.issuerName);
    }
  }

  // key: "decoded:issuer", value: Map<bucket, fee>
  const poolBucketFees = new Map<string, Map<string, number>>();

  for (const row of volumeRows) {
    const decoded = decodeCurrency(row.currency);
    const key = `${decoded}:${row.issuer}`;
    const feeRate = feeMap.get(key);
    if (!feeRate) continue;

    const volumeXrp = Number(row.xrp_volume_drops) / 1_000_000;
    const fee = volumeXrp * feeRate;

    bucketFees.set(row.bucket, (bucketFees.get(row.bucket) ?? 0) + fee);
    tokenFees.set(key, (tokenFees.get(key) ?? 0) + fee);

    let poolBuckets = poolBucketFees.get(key);
    if (!poolBuckets) {
      poolBuckets = new Map<string, number>();
      poolBucketFees.set(key, poolBuckets);
    }
    poolBuckets.set(row.bucket, (poolBuckets.get(row.bucket) ?? 0) + fee);
  }

  const timeSeries: AMMRevenuePoint[] = Array.from(bucketFees.entries())
    .map(([bucket, fee]) => ({
      timestamp: new Date(bucket).getTime(),
      estimatedFeeXrp: fee,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const periodFeeXrp = timeSeries.reduce((sum, p) => sum + p.estimatedFeeXrp, 0);

  // Top earners — retain the full currency:issuer key to avoid ambiguity
  // when multiple tokens share the same decoded currency name.
  const topEarners = Array.from(tokenFees.entries())
    .map(([key, feeXrp]) => {
      const currency = key.split(":")[0];
      return {
        key,
        currency,
        issuerName: nameMap.get(key) ?? null,
        feeXrp,
      };
    })
    .sort((a, b) => b.feeXrp - a.feeXrp)
    .slice(0, 10);

  // Build per-pool time series for the top 10 earners
  const topKeys = topEarners.map((e) => e.key);

  const poolSeries: AMMPoolRevenueSeries[] = topKeys.map((key) => {
    const currency = key.split(":")[0];
    const buckets = poolBucketFees.get(key);
    const data: AMMRevenuePoint[] = buckets
      ? Array.from(buckets.entries())
          .map(([bucket, fee]) => ({ timestamp: new Date(bucket).getTime(), estimatedFeeXrp: fee }))
          .sort((a, b) => a.timestamp - b.timestamp)
      : [];
    return { currency, issuerName: nameMap.get(key) ?? null, data };
  });

  const result = { timeSeries, total: { periodFeeXrp, topEarners }, poolSeries };
  analyticsCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  XRP Supply / Cumulative Burn                                        */
/* ------------------------------------------------------------------ */

const GENESIS_SUPPLY_XRP = 100_000_000_000;

export async function getCumulativeBurnTimeSeries(
  period: Period = "7d",
): Promise<{ timeSeries: XRPSupplyPoint[]; total: XRPSupplyTotal }> {
  const cacheKey = `xrp-supply:${period}`;
  const cached = analyticsCache.get(cacheKey) as
    | { timeSeries: XRPSupplyPoint[]; total: XRPSupplyTotal }
    | undefined;
  if (cached) return cached;

  // Composes via getFeeBurnTimeSeries + getFeeBurnTotal — both are CH-backed
  // after the volume.ts migration, so this function does not need to query
  // ClickHouse directly.
  const [feeSeries, allTimeBurn] = await Promise.all([
    getFeeBurnTimeSeries(period),
    getFeeBurnTotal("all"),
  ]);

  // Compute how much was burned before this period's data
  const periodBurnXrp = feeSeries.reduce(
    (s, p) => s + Number(p.burnDrops) / 1_000_000,
    0,
  );
  const prePeriodBurn = allTimeBurn.totalXrp - periodBurnXrp;

  let cumulative = prePeriodBurn;
  const timeSeries: XRPSupplyPoint[] = feeSeries.map((p) => {
    cumulative += Number(p.burnDrops) / 1_000_000;
    return {
      timestamp: p.timestamp,
      cumulativeBurnXrp: cumulative,
      remainingSupplyXrp: GENESIS_SUPPLY_XRP - cumulative,
    };
  });

  const total: XRPSupplyTotal = {
    totalBurnedXrp: allTimeBurn.totalXrp,
    remainingSupplyXrp: GENESIS_SUPPLY_XRP - allTimeBurn.totalXrp,
    periodBurnXrp,
  };

  const result = { timeSeries, total };
  analyticsCache.set(cacheKey, result);
  return result;
}
