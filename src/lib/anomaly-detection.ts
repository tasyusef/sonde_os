/**
 * Network Anomaly Detection — Log-Z scoring with seasonal buckets.
 *
 * Detects anomalous network activity across 4 metrics:
 *   - TX count (hourly)
 *   - DEX volume (hourly)
 *   - Fee burn (hourly)
 *   - Active accounts (daily, compared by weekday)
 *
 * Uses 168 seasonal buckets (7 days x 24 hours) over 4-week history.
 * Sparse buckets (<4 data points) fall back to global rolling average.
 */

import "server-only";
import { query as chQuery } from "./clickhouse-client";
import { LRUCache, singleflight } from "./cache";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type MetricType = "tx_count" | "dex_volume" | "active_accounts" | "fee_burn";
export type Severity = "notable" | "significant" | "extreme";
type ConfirmationStatus = "developing" | "confirmed";
type ConfidenceLevel = "high" | "low";

export interface Anomaly {
  id: string;
  metric: MetricType;
  severity: Severity;
  confirmation: ConfirmationStatus;
  confidence: ConfidenceLevel;
  zScore: number;
  currentValue: number;
  expectedValue: number;
  deviation: number;
  consecutiveHours: number;
  detectedAt: string;
  description: string;
}

/* ------------------------------------------------------------------ */
/*  Metric config                                                      */
/* ------------------------------------------------------------------ */

interface MetricConfig {
  label: string;
  threshold: number;
  useMAD: boolean;
  absoluteFloor?: number; // skip if current value below this
}

const METRIC_CONFIG: Record<MetricType, MetricConfig> = {
  tx_count: { label: "Transaction Volume", threshold: 2.5, useMAD: false },
  dex_volume: { label: "DEX Volume", threshold: 3.0, useMAD: false, absoluteFloor: 50e9 }, // 50K XRP in drops
  active_accounts: { label: "Active Accounts", threshold: 2.5, useMAD: false },
  fee_burn: { label: "Fee Burn Rate", threshold: 3.5, useMAD: true },
};

/* ------------------------------------------------------------------ */
/*  Caches                                                             */
/* ------------------------------------------------------------------ */

const anomalyCache = new LRUCache<unknown>(1, 2 * 60_000); // 2 min
const bucketCache = new LRUCache<unknown>(4, 10 * 60_000); // 10 min per metric

/* ------------------------------------------------------------------ */
/*  Consecutive-hour tracking (survives within process via globalThis) */
/* ------------------------------------------------------------------ */

const globalForAnomaly = globalThis as unknown as {
  _anomalyConsecutive?: Map<MetricType, { startHour: string; count: number }>;
  _anomalyCooldown?: Map<MetricType, { until: number; severity: Severity }>;
};

if (!globalForAnomaly._anomalyConsecutive) {
  globalForAnomaly._anomalyConsecutive = new Map();
}
if (!globalForAnomaly._anomalyCooldown) {
  globalForAnomaly._anomalyCooldown = new Map();
}

const consecutive = globalForAnomaly._anomalyConsecutive;
const cooldowns = globalForAnomaly._anomalyCooldown;

/* ------------------------------------------------------------------ */
/*  Math helpers                                                       */
/* ------------------------------------------------------------------ */

function logTransform(v: number): number {
  return Math.log(v + 1);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeLogZ(currentValue: number, bucketValues: number[]): number {
  const logCurrent = logTransform(currentValue);
  const logValues = bucketValues.map(logTransform);
  const m = mean(logValues);
  const sd = stdDev(logValues);
  if (sd === 0) return currentValue > 0 ? Infinity : 0;
  return (logCurrent - m) / sd;
}

function computeMADZ(currentValue: number, bucketValues: number[]): number {
  const logCurrent = logTransform(currentValue);
  const logValues = bucketValues.map(logTransform);
  const med = median(logValues);
  const mad = median(logValues.map((v) => Math.abs(v - med)));
  if (mad === 0) return 0;
  return (logCurrent - med) / (mad * 1.4826);
}

/* ------------------------------------------------------------------ */
/*  Seasonal bucket key: dayOfWeek * 24 + hourOfDay                    */
/* ------------------------------------------------------------------ */

function bucketKey(date: Date): number {
  return date.getUTCDay() * 24 + date.getUTCHours();
}

/* ------------------------------------------------------------------ */
/*  ClickHouse queries — historical bucket data                        */
/* ------------------------------------------------------------------ */

type HourlyRow = Record<string, unknown> & { hour: string; value: string };
type DailyRow = Record<string, unknown> & { day: string; value: string };

async function fetchTxCountHistory(): Promise<Map<number, number[]>> {
  const rows = await chQuery<HourlyRow>(
    `SELECT
       toStartOfHour(hour) AS hour,
       sum(count) AS value
     FROM mv_hourly_tx_volume
     WHERE hour >= now() - INTERVAL 4 WEEK AND hour < toStartOfHour(now())
     GROUP BY hour
     ORDER BY hour`,
  );
  return buildHourlyBuckets(rows);
}

async function fetchDexVolumeHistory(): Promise<Map<number, number[]>> {
  const rows = await chQuery<HourlyRow>(
    `SELECT
       toStartOfHour(timestamp) AS hour,
       sum(xrp_volume_drops) AS value
     FROM dex_trades
     WHERE timestamp >= now() - INTERVAL 4 WEEK AND timestamp < toStartOfHour(now())
     GROUP BY hour
     ORDER BY hour`,
  );
  return buildHourlyBuckets(rows);
}

async function fetchFeeBurnHistory(): Promise<Map<number, number[]>> {
  const rows = await chQuery<HourlyRow>(
    `SELECT
       toStartOfHour(hour) AS hour,
       sum(total_fee_drops) AS value
     FROM mv_hourly_tx_volume
     WHERE hour >= now() - INTERVAL 4 WEEK AND hour < toStartOfHour(now())
     GROUP BY hour
     ORDER BY hour`,
  );
  return buildHourlyBuckets(rows);
}

async function fetchActiveAccountsHistory(): Promise<Map<number, number[]>> {
  const rows = await chQuery<DailyRow>(
    `SELECT
       day,
       uniqExactMerge(unique_accounts) AS value
     FROM mv_daily_active_accounts
     WHERE day >= today() - 28 AND day < today()
     GROUP BY day
     ORDER BY day`,
  );
  // For daily data, bucket by dayOfWeek only (0-6)
  const buckets = new Map<number, number[]>();
  for (const row of rows) {
    const d = new Date(row.day);
    const key = d.getUTCDay(); // 0-6
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(parseFloat(row.value));
  }
  return buckets;
}

function buildHourlyBuckets(rows: HourlyRow[]): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  for (const row of rows) {
    const d = new Date(row.hour);
    const key = bucketKey(d);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(parseFloat(row.value));
  }
  return buckets;
}

/* ------------------------------------------------------------------ */
/*  ClickHouse queries — current values                                */
/* ------------------------------------------------------------------ */

async function fetchCurrentTxCount(): Promise<number> {
  const rows = await chQuery<{ value: string }>(
    `SELECT sum(count) AS value FROM mv_hourly_tx_volume WHERE hour = toStartOfHour(now())`,
  );
  return parseFloat(rows[0]?.value ?? "0");
}

async function fetchCurrentDexVolume(): Promise<number> {
  const rows = await chQuery<{ value: string }>(
    `SELECT sum(xrp_volume_drops) AS value FROM dex_trades WHERE timestamp >= toStartOfHour(now())`,
  );
  return parseFloat(rows[0]?.value ?? "0");
}

async function fetchCurrentFeeBurn(): Promise<number> {
  const rows = await chQuery<{ value: string }>(
    `SELECT sum(total_fee_drops) AS value FROM mv_hourly_tx_volume WHERE hour = toStartOfHour(now())`,
  );
  return parseFloat(rows[0]?.value ?? "0");
}

async function fetchCurrentActiveAccounts(): Promise<number> {
  const rows = await chQuery<{ value: string }>(
    `SELECT uniqExactMerge(unique_accounts) AS value FROM mv_daily_active_accounts WHERE day = today()`,
  );
  return parseFloat(rows[0]?.value ?? "0");
}

/* ------------------------------------------------------------------ */
/*  Severity classification                                            */
/* ------------------------------------------------------------------ */

const SEVERITY_ORDER: Severity[] = ["notable", "significant", "extreme"];

function classifySeverity(zScore: number, consecutiveHours: number): Severity {
  if (Math.abs(zScore) > 3.5 || consecutiveHours >= 3) return "extreme";
  if (Math.abs(zScore) > 2.5 || consecutiveHours >= 2) return "significant";
  return "notable";
}

function severityIndex(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

/* ------------------------------------------------------------------ */
/*  Per-metric evaluation                                              */
/* ------------------------------------------------------------------ */

async function evaluateMetric(
  metric: MetricType,
): Promise<Anomaly | null> {
  const config = METRIC_CONFIG[metric];

  // Fetch historical buckets (cached 10 min)
  const historyFetchers: Record<MetricType, () => Promise<Map<number, number[]>>> = {
    tx_count: fetchTxCountHistory,
    dex_volume: fetchDexVolumeHistory,
    fee_burn: fetchFeeBurnHistory,
    active_accounts: fetchActiveAccountsHistory,
  };

  const currentFetchers: Record<MetricType, () => Promise<number>> = {
    tx_count: fetchCurrentTxCount,
    dex_volume: fetchCurrentDexVolume,
    fee_burn: fetchCurrentFeeBurn,
    active_accounts: fetchCurrentActiveAccounts,
  };

  const [buckets, currentValue] = await Promise.all([
    singleflight(`buckets:${metric}`, bucketCache, historyFetchers[metric]),
    currentFetchers[metric](),
  ]);

  // Absolute floor check
  if (config.absoluteFloor && currentValue < config.absoluteFloor) return null;

  // Get seasonal bucket values
  const now = new Date();
  const key = metric === "active_accounts" ? now.getUTCDay() : bucketKey(now);
  let bucketValues = (buckets as Map<number, number[]>).get(key) ?? [];
  let confidence: ConfidenceLevel = "high";

  // Sparse bucket fallback: use all values globally
  if (bucketValues.length < 4) {
    const allValues: number[] = [];
    for (const vals of (buckets as Map<number, number[]>).values()) {
      allValues.push(...vals);
    }
    bucketValues = allValues;
    confidence = "low";
  }

  if (bucketValues.length < 2) return null;

  // Compute z-score
  const zScore = config.useMAD
    ? computeMADZ(currentValue, bucketValues)
    : computeLogZ(currentValue, bucketValues);

  if (zScore < 2.0) {
    // Below minimum threshold — clear consecutive tracking
    consecutive.delete(metric);
    return null;
  }

  if (zScore < config.threshold && confidence === "high") {
    // Below metric-specific threshold (but above 2.0) — only flag if low confidence
    consecutive.delete(metric);
    return null;
  }

  // Track consecutive hours
  const currentHour = now.toISOString().slice(0, 13);
  const prev = consecutive.get(metric);
  let consecutiveHours = 1;
  if (prev && prev.startHour !== currentHour) {
    // Check if this is the next hour
    const prevDate = new Date(prev.startHour + ":00:00Z");
    const hourDiff = (now.getTime() - prevDate.getTime()) / (60 * 60 * 1000);
    if (hourDiff <= 2) {
      consecutiveHours = prev.count + 1;
    }
  } else if (prev) {
    consecutiveHours = prev.count;
  }
  consecutive.set(metric, { startHour: currentHour, count: consecutiveHours });

  const severity = classifySeverity(zScore, consecutiveHours);

  // Cooldown check: skip if same metric was flagged within 4h unless severity increased
  const cd = cooldowns.get(metric);
  if (cd && Date.now() < cd.until && severityIndex(severity) <= severityIndex(cd.severity)) {
    return null;
  }

  // Set cooldown
  cooldowns.set(metric, { until: Date.now() + 4 * 60 * 60 * 1000, severity });

  const expectedValue = mean(bucketValues);
  const deviation = expectedValue > 0 ? ((currentValue - expectedValue) / expectedValue) * 100 : 0;

  return {
    id: `${metric}:${key}`,
    metric,
    severity,
    confirmation: consecutiveHours >= 2 ? "confirmed" : "developing",
    confidence,
    zScore: Math.round(zScore * 100) / 100,
    currentValue,
    expectedValue: Math.round(expectedValue),
    deviation: Math.round(deviation),
    consecutiveHours,
    detectedAt: now.toISOString(),
    description: `${config.label} is ${Math.abs(Math.round(deviation))}% ${deviation >= 0 ? "above" : "below"} seasonal baseline`,
  };
}

/* ------------------------------------------------------------------ */
/*  Main export                                                        */
/* ------------------------------------------------------------------ */

export async function detectAnomalies(): Promise<Anomaly[]> {
  return singleflight("anomalies:current", anomalyCache, async () => {
    const metrics: MetricType[] = ["tx_count", "dex_volume", "active_accounts", "fee_burn"];

    const results = await Promise.allSettled(
      metrics.map((m) => evaluateMetric(m)),
    );

    const anomalies: Anomaly[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        anomalies.push(result.value);
      }
    }

    // Sort by severity (extreme first)
    anomalies.sort((a, b) => severityIndex(b.severity) - severityIndex(a.severity));
    return anomalies;
  });
}
