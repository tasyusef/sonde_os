/**
 * Graph feature computation for account risk profiling.
 *
 * Features computed from CH source tables:
 * - Degree centrality (payment + trade connection counts) — `value_transfer_events` + `dex_trades`
 * - In/out payment ratio — `value_transfer_events`
 * - Unique counterparty count — `mv_account_counterparty_daily`
 * - Temporal activity span — `transactions` min/max timestamp
 *
 * Pre-2026-04-30 these read from Neo4j PAYMENT/DEX_TRADE edges + node
 * properties (`first_seen`, `last_active`). Migrated to CH (the source
 * of record). See `docs/plans/neo4j-removal.md`.
 *
 * Unique-counterparty query swapped to `mv_account_counterparty_daily`
 * 2026-05-04 (slice 1 of `db-first-page-loads`) once the MV was seeded.
 */

import "server-only";
import { query as chQuery } from "./clickhouse-client";

export interface GraphFeatures {
  /** Total unique connections (payment + trade) */
  degree: number;
  /** Incoming payment count */
  inDegree: number;
  /** Outgoing payment count */
  outDegree: number;
  /** DEX trade count */
  tradeCount: number;
  /** Unique counterparties */
  uniqueCounterparties: number;
  /** In/out ratio (>1 = net receiver, <1 = net sender) */
  inOutRatio: number | null;
  /** Activity span in seconds (last_active - first_seen) */
  activitySpan: number;
  /** First seen timestamp */
  firstSeen: number | null;
  /** Last active timestamp */
  lastActive: number | null;
}

export async function computeGraphFeatures(account: string): Promise<GraphFeatures | null> {
  // Four queries in parallel. Each is partition-pruned (account is in
  // the ORDER BY of value_transfer_events / transactions) or
  // bloom-filter-skipped (taker/maker on dex_trades), so each takes
  // tens of ms even on the full event log.
  const [paymentRows, dexRows, counterpartyRows, timeRows] = await Promise.all([
    // In/out payment counts. Self-payments excluded so a wash payment
    // doesn't double-count as both incoming and outgoing.
    chQuery<{ in_degree: number | string; out_degree: number | string }>(
      `SELECT
         countIf(to_account = {account:String}) AS in_degree,
         countIf(from_account = {account:String}) AS out_degree
       FROM value_transfer_events
       WHERE (from_account = {account:String} OR to_account = {account:String})
         AND from_account != to_account`,
      { account },
    ),
    // DEX trade count — undirected (taker OR maker).
    chQuery<{ trade_count: number | string }>(
      `SELECT count() AS trade_count
       FROM dex_trades
       WHERE taker = {account:String} OR maker = {account:String}`,
      { account },
    ),
    // Unique counterparties via the seeded `mv_account_counterparty_daily`
    // (PK `(account, counterparty, day)`). Partition-pruned by `account`,
    // so this is a sub-millisecond range scan. Self-edge filter
    // `counterparty != account` matches the pre-MV semantics — the source
    // views only filter empty strings, not self-payments.
    chQuery<{ unique_counterparties: number | string }>(
      `SELECT count(DISTINCT counterparty) AS unique_counterparties
       FROM mv_account_counterparty_daily
       WHERE account = {account:String}
         AND counterparty != {account:String}`,
      { account },
    ),
    // First-seen / last-active. Neo4j stored these as node properties
    // updated at ingestion; CH derives them on read from raw transactions.
    chQuery<{ first_seen: number | string | null; last_active: number | string | null }>(
      `SELECT
         toUnixTimestamp(min(timestamp)) AS first_seen,
         toUnixTimestamp(max(timestamp)) AS last_active
       FROM transactions
       WHERE account = {account:String}`,
      { account },
    ),
  ]);

  const inDeg = Number(paymentRows[0]?.in_degree) || 0;
  const outDeg = Number(paymentRows[0]?.out_degree) || 0;
  const trades = Number(dexRows[0]?.trade_count) || 0;
  const counterparties = Number(counterpartyRows[0]?.unique_counterparties) || 0;

  const firstSeenRaw = timeRows[0]?.first_seen;
  const lastActiveRaw = timeRows[0]?.last_active;
  const firstSeen = firstSeenRaw != null ? Number(firstSeenRaw) : null;
  const lastActive = lastActiveRaw != null ? Number(lastActiveRaw) : null;

  // Equivalent of "Neo4j MATCH found no node": no graph activity AND
  // no record of this account in the transactions table at all.
  if (inDeg + outDeg + trades === 0 && counterparties === 0 && firstSeen == null) {
    return null;
  }

  const activitySpan = firstSeen != null && lastActive != null ? lastActive - firstSeen : 0;

  return {
    degree: inDeg + outDeg + trades,
    inDegree: inDeg,
    outDegree: outDeg,
    tradeCount: trades,
    uniqueCounterparties: counterparties,
    inOutRatio: outDeg > 0 ? inDeg / outDeg : null,
    activitySpan,
    firstSeen,
    lastActive,
  };
}
