/**
 * Behavioral feature computation from ClickHouse time-series data.
 *
 * Per-account statistics for risk profiling:
 * - Transaction frequency and volume trends
 * - Active hours distribution (entropy)
 * - Transaction type diversity
 * - Burst detection (unusually high activity periods)
 */

import "server-only";
import { readOnlyQuery } from "./clickhouse-client";

export interface BehavioralFeatures {
  /** Total transaction count */
  txCount: number;
  /** Total fee paid in drops */
  totalFeeDrops: number;
  /** Distinct transaction types used */
  txTypes: string[];
  /** Number of distinct tx types */
  txTypeDiversity: number;
  /** Average transactions per day */
  avgTxPerDay: number;
  /** Max transactions in a single hour */
  maxTxPerHour: number;
  /** Hour-of-day with most activity (0-23 UTC) */
  peakHourUtc: number;
  /** Activity entropy (0 = all in one hour, high = spread out) */
  hourEntropy: number;
  /** Days with at least one transaction */
  activeDays: number;
  /** First transaction timestamp */
  firstTx: string | null;
  /** Last transaction timestamp */
  lastTx: string | null;
}

export async function computeBehavioralFeatures(account: string): Promise<BehavioralFeatures | null> {
  // Run all ClickHouse queries in parallel
  const [basicStats, hourlyDist, dailyActivity, peakHour] = await Promise.all([
    // Basic stats
    readOnlyQuery<{
      tx_count: string;
      total_fee: string;
      tx_types: string;
      first_tx: string;
      last_tx: string;
    }>(
      `SELECT
         count() AS tx_count,
         sum(fee_drops) AS total_fee,
         groupArray(DISTINCT tx_type) AS tx_types,
         min(timestamp) AS first_tx,
         max(timestamp) AS last_tx
       FROM transactions
       WHERE account = {account:String}`,
      { account },
    ).catch(() => []),

    // Hourly distribution (for entropy calculation)
    readOnlyQuery<{ hour: number; cnt: string }>(
      `SELECT
         toHour(timestamp) AS hour,
         count() AS cnt
       FROM transactions
       WHERE account = {account:String}
       GROUP BY hour
       ORDER BY hour`,
      { account },
    ).catch(() => []),

    // Daily activity count + peak hourly density. The outer SELECT
    // pulls from the per-hour aggregate, so `timestamp` is out of scope
    // out there — only the projected `h` and `hourly_count` remain.
    // Use `toDate(h)` to derive the day from the hour bucket. Earlier
    // version referenced `toDate(timestamp)` and 500'd with
    // "Unknown identifier 'timestamp'" — the page survived via the
    // `.catch(() => [])` fallback so the BehavioralProfile widget
    // silently dropped these stats.
    readOnlyQuery<{ active_days: string; max_hourly: string }>(
      `SELECT
         uniqExact(toDate(h)) AS active_days,
         max(hourly_count) AS max_hourly
       FROM (
         SELECT toStartOfHour(timestamp) AS h, count() AS hourly_count
         FROM transactions
         WHERE account = {account:String}
         GROUP BY h
       )`,
      { account },
    ).catch(() => []),

    // Peak hour
    readOnlyQuery<{ peak_hour: number }>(
      `SELECT toHour(timestamp) AS peak_hour
       FROM transactions
       WHERE account = {account:String}
       GROUP BY peak_hour
       ORDER BY count() DESC
       LIMIT 1`,
      { account },
    ).catch(() => []),
  ]);

  const stats = basicStats[0];
  if (!stats || Number(stats.tx_count) === 0) return null;

  const txCount = Number(stats.tx_count);
  let txTypes: string[] = [];
  try {
    txTypes = typeof stats.tx_types === "string"
      ? JSON.parse(stats.tx_types)
      : (stats.tx_types as unknown as string[]) ?? [];
  } catch { /* malformed groupArray result */ }

  // Compute activity span in days
  const firstTx = stats.first_tx;
  const lastTx = stats.last_tx;
  const firstDate = new Date(firstTx);
  const lastDate = new Date(lastTx);
  const firstMs = firstDate.getTime();
  const lastMs = lastDate.getTime();
  const spanDays = Number.isFinite(firstMs) && Number.isFinite(lastMs)
    ? Math.max(1, (lastMs - firstMs) / (86400 * 1000))
    : 1;

  // Compute hour entropy (Shannon entropy over 24 bins)
  let entropy = 0;
  if (hourlyDist.length > 0) {
    const total = hourlyDist.reduce((sum, r) => sum + Number(r.cnt), 0);
    for (const row of hourlyDist) {
      const p = Number(row.cnt) / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }
  }

  return {
    txCount,
    totalFeeDrops: Number(stats.total_fee),
    txTypes,
    txTypeDiversity: txTypes.length,
    avgTxPerDay: txCount / spanDays,
    maxTxPerHour: Number(dailyActivity[0]?.max_hourly ?? 0),
    peakHourUtc: Number(peakHour[0]?.peak_hour ?? 0),
    hourEntropy: Math.round(entropy * 100) / 100,
    activeDays: Number(dailyActivity[0]?.active_days ?? 0),
    firstTx: firstTx === "1970-01-01 00:00:00" ? null : firstTx,
    lastTx: lastTx === "1970-01-01 00:00:00" ? null : lastTx,
  };
}
