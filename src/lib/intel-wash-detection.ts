/**
 * Wash trading and suspicious pattern detection.
 *
 * Heuristics:
 * 1. Circular payment loops — funds return to sender within 2 hops
 * 2. Rapid pair trading — high-frequency small trades between a pair
 * 3. Low counterparty diversity — accounts that only transact with 1-2 others
 *
 * Pre-2026-04-30 these read from Neo4j PAYMENT/DEX_TRADE edges. Migrated
 * to CH `value_transfer_events` + `dex_trades` (the source of record).
 * See `docs/plans/neo4j-removal.md`.
 */

import "server-only";
import { query as chQuery } from "./clickhouse-client";

export interface WashFlag {
  pattern: "circular_payments" | "rapid_pair_trading" | "low_diversity";
  confidence: number; // 0-1
  evidence: string;
  details: Record<string, unknown>;
}

/**
 * Detect circular payment patterns — funds that return to the sender
 * within 2 hops in the last 30 days.
 *
 * The prior Cypher version supported 1..3-hop traversal but the
 * WITH-clause grouping (`length(path)+1 AS loop_length, ... AS total_amount`
 * → implicit GROUP BY both) yielded ambiguous loop counts and rarely
 * surfaced anything beyond 2-hop. Dropping multi-hop simplifies the
 * query and concentrates the signal on the dominant wash pattern
 * (immediate self-payback). Multi-hop can be added as a separate
 * sub-detector later if real cases show up.
 */
async function detectCircularPayments(account: string): Promise<WashFlag | null> {
  const rows = await chQuery<{ loop_count: number | string }>(
    `SELECT count() AS loop_count
     FROM value_transfer_events e1
     INNER JOIN value_transfer_events e2
       ON e1.to_account = e2.from_account
     WHERE e1.from_account = {account:String}
       AND e2.to_account = {account:String}
       AND e1.to_account != {account:String}
       AND e1.timestamp >= now() - INTERVAL 30 DAY
       AND e2.timestamp >= now() - INTERVAL 30 DAY
       AND e2.timestamp >= e1.timestamp`,
    { account },
  );

  const totalLoops = Number(rows[0]?.loop_count) || 0;
  if (totalLoops === 0) return null;

  // Confidence based on number of loops found (matches prior formula).
  const confidence = Math.min(1, totalLoops / 10);

  return {
    pattern: "circular_payments",
    confidence,
    evidence: `${totalLoops} circular payment loop(s) detected (2 hops, last 30d)`,
    details: {
      loops: [{ hops: 2, count: totalLoops }],
    },
  };
}

/**
 * Detect rapid pair trading — counterparts where average inter-trade
 * interval is under 5 minutes (300s) and total trade count is ≥ 5.
 *
 * `avg_interval = (max_ts - min_ts) / (n - 1)` is mathematically
 * equivalent to averaging consecutive deltas (sum telescopes to max -
 * min) and avoids needing a window function — faster on dense
 * counterparty histories.
 */
async function detectRapidPairTrading(account: string): Promise<WashFlag | null> {
  const rows = await chQuery<{
    counterparty: string;
    trade_count: number | string;
    avg_interval: number | string;
  }>(
    `SELECT
       counterparty,
       count() AS trade_count,
       (max(ts) - min(ts)) / nullIf(count() - 1, 0) AS avg_interval
     FROM (
       SELECT
         IF(taker = {account:String}, maker, taker) AS counterparty,
         toUInt32(timestamp) AS ts
       FROM dex_trades
       WHERE (taker = {account:String} OR maker = {account:String})
         AND timestamp >= now() - INTERVAL 30 DAY
     )
     WHERE counterparty != '' AND counterparty != {account:String}
     GROUP BY counterparty
     HAVING count() >= 5 AND avg_interval < 300
     ORDER BY trade_count DESC
     LIMIT 5`,
    { account },
  );

  if (rows.length === 0) return null;

  const totalTrades = rows.reduce((sum, r) => sum + (Number(r.trade_count) || 0), 0);
  const confidence = Math.min(1, totalTrades / 50);

  return {
    pattern: "rapid_pair_trading",
    confidence,
    evidence: `${rows.length} counterpart(s) with rapid trading (${totalTrades} total trades, avg interval <5min)`,
    details: {
      pairs: rows.map((r) => ({
        counterparty: r.counterparty,
        tradeCount: Number(r.trade_count) || 0,
        avgIntervalSeconds: Math.round(Number(r.avg_interval) || 0),
      })),
    },
  };
}

/**
 * Detect low counterparty diversity — accounts with ≥10 edges across
 * payment + DEX trade history but ≤2 unique counterparts.
 *
 * Filtering is done in JS rather than via HAVING so we can return null
 * cleanly when the threshold isn't met (CH HAVING without GROUP BY is
 * awkward to express).
 */
async function detectLowDiversity(account: string): Promise<WashFlag | null> {
  const rows = await chQuery<{
    total_rels: number | string;
    unique_counterparties: number | string;
  }>(
    `SELECT
       count() AS total_rels,
       count(DISTINCT counterparty) AS unique_counterparties
     FROM (
       SELECT to_account AS counterparty FROM value_transfer_events
         WHERE from_account = {account:String}
           AND to_account != ''
           AND to_account != {account:String}
       UNION ALL
       SELECT from_account AS counterparty FROM value_transfer_events
         WHERE to_account = {account:String}
           AND from_account != ''
           AND from_account != {account:String}
       UNION ALL
       SELECT maker AS counterparty FROM dex_trades
         WHERE taker = {account:String}
           AND maker != ''
           AND maker != {account:String}
       UNION ALL
       SELECT taker AS counterparty FROM dex_trades
         WHERE maker = {account:String}
           AND taker != ''
           AND taker != {account:String}
     )`,
    { account },
  );

  const totalRels = Number(rows[0]?.total_rels) || 0;
  const uniqueCp = Number(rows[0]?.unique_counterparties) || 0;
  if (totalRels < 10 || uniqueCp > 2) return null;

  const ratio = uniqueCp / totalRels;
  const confidence = Math.min(1, (1 - ratio) * 0.8);

  return {
    pattern: "low_diversity",
    confidence,
    evidence: `${totalRels} transactions with only ${uniqueCp} unique counterpart(s)`,
    details: {
      totalTransactions: totalRels,
      uniqueCounterparties: uniqueCp,
      diversityRatio: Math.round(ratio * 100) / 100,
    },
  };
}

/**
 * Run all wash trading heuristics for an account.
 * Returns only flags with confidence >= threshold.
 */
export async function detectWashPatterns(
  account: string,
  confidenceThreshold = 0.2,
): Promise<WashFlag[]> {
  const [circular, rapid, diversity] = await Promise.all([
    detectCircularPayments(account).catch(() => null),
    detectRapidPairTrading(account).catch(() => null),
    detectLowDiversity(account).catch(() => null),
  ]);

  return [circular, rapid, diversity]
    .filter((f): f is WashFlag => f !== null && f.confidence >= confidenceThreshold);
}
