/**
 * Whale activity detection via token holder snapshot diffing.
 *
 * Compares consecutive token_holder_snapshots to detect:
 * - Accumulation/distribution by top 10 holders
 * - Roster changes (new entries/exits from top 10)
 * - Snapshot gaps flagged as "low confidence"
 *
 * Reads from ClickHouse `token_holder_snapshots` (migrated from PG
 * 2026-04-28). Schema: `snapshot_time DateTime64(3)`, addresses are
 * plain `String`, balance/total_supply are `Float64`.
 */

import "server-only";
import { query as chQuery } from "@/lib/clickhouse-client";
import { toLedgerCurrency } from "./xrpl-helpers";
import { LRUCache } from "./cache";

/* ── Types ── */

export interface WhaleEvent {
  snapshotTime: string;
  holderAddress: string;
  /** Balance change from previous snapshot */
  delta: number;
  /** Current balance */
  balance: number;
  type: "accumulation" | "distribution" | "new_entry" | "exit";
  /** false if gap between snapshots >6h */
  highConfidence: boolean;
}

interface WhaleActivityResult {
  currency: string;
  issuer: string;
  events: WhaleEvent[];
  snapshotCount: number;
}

/* ── Cache (5 min) ── */

const whaleCache = new LRUCache<WhaleActivityResult>(50, 5 * 60_000);

/* ── Period to interval ── */

function periodToHours(period: string): number {
  switch (period) {
    case "24h": return 24;
    case "7d": return 168;
    case "30d": return 720;
    default: return 168;
  }
}

/* ── Main query ── */

export async function getWhaleActivity(
  currencyInput: string,
  issuer: string,
  period: string = "7d",
): Promise<WhaleActivityResult> {
  // CH stores 4+ char tickers as 40-char hex (XRPL convention). Pages
  // can pass either the display form (e.g. "ARMY") or the hex form;
  // normalize so the WHERE clause matches stored data either way.
  const currency = toLedgerCurrency(currencyInput);

  const cacheKey = `whale:${currency}:${issuer}:${period}`;
  const cached = whaleCache.get(cacheKey);
  if (cached) return cached;

  const hours = periodToHours(period);

  // Fetch all snapshots within the period, ordered by time then rank.
  // CH balance/rank come back as Float64/UInt8 — already numeric, no
  // string parsing needed (unlike the PG numeric columns).
  // Alias the toString'd timestamp as `snap_str` (NOT `snapshot_time`)
  // — using the same name as the column makes CH's WHERE bind to the
  // alias, which would error when comparing to DateTime64 ranges.
  const rows = await chQuery<{
    snap_str: string;
    holder_address: string;
    balance: number;
    rank: number;
  }>(
    `SELECT toString(snapshot_time) AS snap_str, holder_address, balance, rank
     FROM token_holder_snapshots
     WHERE currency = {currency:String}
       AND issuer = {issuer:String}
       AND snapshot_time > now() - INTERVAL {hours:UInt32} HOUR
     ORDER BY snapshot_time ASC, rank ASC`,
    { currency, issuer, hours },
  );

  if (rows.length === 0) {
    const result: WhaleActivityResult = { currency: currencyInput, issuer, events: [], snapshotCount: 0 };
    whaleCache.set(cacheKey, result);
    return result;
  }

  // Group rows by snapshot time
  const snapshots = new Map<string, Map<string, { balance: number; rank: number }>>();
  for (const row of rows) {
    const time = row.snap_str;
    if (!snapshots.has(time)) snapshots.set(time, new Map());
    snapshots.get(time)!.set(row.holder_address, {
      balance: row.balance || 0,
      rank: row.rank,
    });
  }

  const snapshotTimes = Array.from(snapshots.keys()).sort();
  const events: WhaleEvent[] = [];

  // Diff consecutive snapshots
  for (let i = 1; i < snapshotTimes.length; i++) {
    const prevTime = snapshotTimes[i - 1];
    const currTime = snapshotTimes[i];
    const prev = snapshots.get(prevTime)!;
    const curr = snapshots.get(currTime)!;

    // Check gap between snapshots (>6h = low confidence)
    const gapMs = new Date(currTime).getTime() - new Date(prevTime).getTime();
    const highConfidence = gapMs <= 6 * 60 * 60 * 1000;

    // Check for new entries and balance changes
    for (const [address, { balance }] of curr) {
      const prevHolder = prev.get(address);
      if (!prevHolder) {
        // New entry into top 10
        events.push({
          snapshotTime: currTime,
          holderAddress: address,
          delta: balance,
          balance,
          type: "new_entry",
          highConfidence,
        });
      } else {
        const delta = balance - prevHolder.balance;
        if (Math.abs(delta) < 0.000001) continue; // Skip negligible changes
        events.push({
          snapshotTime: currTime,
          holderAddress: address,
          delta,
          balance,
          type: delta > 0 ? "accumulation" : "distribution",
          highConfidence,
        });
      }
    }

    // Check for exits (in prev but not in curr)
    for (const [address, { balance }] of prev) {
      if (!curr.has(address)) {
        events.push({
          snapshotTime: currTime,
          holderAddress: address,
          delta: -balance,
          balance: 0,
          type: "exit",
          highConfidence,
        });
      }
    }
  }

  // Sort by time descending (most recent first), then by absolute delta
  events.sort((a, b) => {
    const timeDiff = new Date(b.snapshotTime).getTime() - new Date(a.snapshotTime).getTime();
    if (timeDiff !== 0) return timeDiff;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

  const result: WhaleActivityResult = {
    currency: currencyInput,
    issuer,
    events: events.slice(0, 100), // Cap at 100 events
    snapshotCount: snapshotTimes.length,
  };
  whaleCache.set(cacheKey, result);
  return result;
}
