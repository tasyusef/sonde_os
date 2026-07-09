/**
 * Query functions for reading token holder snapshots from ClickHouse.
 * Used by the /api/tokens/holders route and TokenHoldersLoader.
 *
 * Migrated from Postgres → ClickHouse 2026-04-28. All queries include
 * a 30s in-memory response cache.
 */

import "server-only";
import { query as chQuery, insert as chInsert } from "@/lib/clickhouse-client";
import { toLedgerCurrency } from "./xrpl-helpers";
import { LRUCache } from "./cache";
import { fetchTopHolders } from "./holder-data";
import type {
  HolderSnapshot,
  HolderHistoryPoint,
  HolderData,
} from "@/types/token";

/* ------------------------------------------------------------------ */
/*  Response cache (30s TTL)                                           */
/* ------------------------------------------------------------------ */

const holderCache = new LRUCache<unknown>(50, 30_000);

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type Period = "7d" | "30d" | "90d" | "all";

/* ------------------------------------------------------------------ */
/*  Get latest holder snapshot for a token                             */
/* ------------------------------------------------------------------ */

export async function getLatestHolderSnapshot(
  currencyInput: string,
  issuer: string,
): Promise<HolderSnapshot | null> {
  // CH stores 4+ char tickers as 40-char hex. Normalize so display-form
  // currencies (e.g. "ARMY") match the stored canonical form.
  const currency = toLedgerCurrency(currencyInput);
  const cacheKey = `holders-latest:${currency}:${issuer}`;
  const cached = holderCache.get(cacheKey) as HolderSnapshot | undefined;
  if (cached) return cached;

  // Aliasing toString(snapshot_time) AS snapshot_time confuses CH:
  // the outer WHERE picks up the alias (a String) instead of the column
  // (DateTime64), then errors comparing String = DateTime64 against the
  // subquery. Use a distinct alias so WHERE keeps binding to the column.
  const rows = await chQuery<{
    snap_str: string;
    holder_address: string;
    balance: number;
    total_supply: number;
    rank: number;
  }>(
    `SELECT toString(snapshot_time) AS snap_str, holder_address, balance, total_supply, rank
     FROM token_holder_snapshots
     WHERE currency = {currency:String}
       AND issuer = {issuer:String}
       AND snapshot_time = (
         SELECT max(snapshot_time)
         FROM token_holder_snapshots
         WHERE currency = {currency:String} AND issuer = {issuer:String}
       )
     ORDER BY rank ASC`,
    { currency, issuer },
  );

  if (rows.length === 0) return null;

  const result: HolderSnapshot = {
    holders: rows.map((r) => ({
      address: r.holder_address,
      balance: r.balance,
      totalSupply: r.total_supply,
      rank: r.rank,
    })),
    snapshotTime: rows[0].snap_str,
  };

  holderCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Get holder history for chart                                       */
/* ------------------------------------------------------------------ */

async function getHolderHistory(
  currencyInput: string,
  issuer: string,
  period: Period = "30d",
): Promise<HolderHistoryPoint[]> {
  const currency = toLedgerCurrency(currencyInput);
  const cacheKey = `holders-history:${currency}:${issuer}:${period}`;
  const cached = holderCache.get(cacheKey) as HolderHistoryPoint[] | undefined;
  if (cached) return cached;

  const cutoff = periodToCutoff(period);

  // Use a distinct alias `snap_str` so the WHERE clause keeps binding
  // to the underlying DateTime64 column (CH alias-shadowing trap).
  const rows = await chQuery<{
    snap_str: string;
    holder_address: string;
    balance: number;
    total_supply: number;
  }>(
    `SELECT toString(snapshot_time) AS snap_str, holder_address, balance, total_supply
     FROM token_holder_snapshots
     WHERE currency = {currency:String}
       AND issuer = {issuer:String}
       AND snapshot_time >= {cutoff:String}
     ORDER BY snapshot_time ASC, rank ASC`,
    { currency, issuer, cutoff: pgCutoffToCh(cutoff) },
  );

  // Group by snapshot_time
  const grouped = new Map<
    string,
    Array<{ address: string; balance: number; totalSupply: number }>
  >();

  for (const row of rows) {
    const time = row.snap_str;
    if (!grouped.has(time)) {
      grouped.set(time, []);
    }
    grouped.get(time)!.push({
      address: row.holder_address,
      balance: row.balance,
      totalSupply: row.total_supply,
    });
  }

  const result: HolderHistoryPoint[] = Array.from(grouped.entries()).map(
    ([time, holders]) => ({ time, holders }),
  );

  holderCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  On-demand snapshot (first-ever view of a token)                    */
/* ------------------------------------------------------------------ */

async function triggerOnDemandSnapshot(
  currencyInput: string,
  issuer: string,
): Promise<HolderSnapshot | null> {
  const currency = toLedgerCurrency(currencyInput);

  // Check if a recent snapshot exists (within last hour)
  const recent = await chQuery<{ cnt: string }>(
    `SELECT toString(count()) AS cnt
     FROM token_holder_snapshots
     WHERE currency = {currency:String}
       AND issuer = {issuer:String}
       AND snapshot_time > now() - INTERVAL 1 HOUR`,
    { currency, issuer },
  );

  if (parseInt(recent[0]?.cnt ?? "0") > 0) {
    return getLatestHolderSnapshot(currency, issuer);
  }

  // Fetch live from XRPL — uses the ledger-canonical currency form.
  const result = await fetchTopHolders(currency, issuer);
  if (result.holders.length === 0) return null;

  const now = new Date();
  const rows = result.holders.map((h, i) => ({
    snapshot_time: chTimestamp(now),
    currency,
    issuer,
    holder_address: h.address,
    balance: h.balance,
    total_supply: result.totalSupply,
    rank: i + 1,
  }));

  await chInsert("token_holder_snapshots", rows);

  return {
    holders: result.holders.map((h, i) => ({
      address: h.address,
      balance: h.balance,
      totalSupply: result.totalSupply,
      rank: i + 1,
    })),
    snapshotTime: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  Combined fetch for the page                                        */
/* ------------------------------------------------------------------ */

export async function getHolderData(
  currency: string,
  issuer: string,
  period: Period = "30d",
): Promise<HolderData> {
  const [current, history] = await Promise.all([
    getLatestHolderSnapshot(currency, issuer),
    getHolderHistory(currency, issuer, period),
  ]);

  // If no snapshots exist, trigger on-demand
  if (!current) {
    const onDemand = await triggerOnDemandSnapshot(currency, issuer);
    return { current: onDemand, history: [] };
  }

  return { current, history };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function periodToCutoff(period: Period): string {
  const now = new Date();
  switch (period) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d":
      return new Date(
        now.getTime() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
    case "90d":
      return new Date(
        now.getTime() - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
    case "all":
      // Use 1-year cutoff instead of unbounded to prevent runaway growth.
      // Holder snapshots at 4h intervals × 10 holders × 365 days ≈ 22K rows
      // which is manageable. True "all-time" would grow without bound.
      return new Date(
        now.getTime() - 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
  }
}

/** ISO timestamp ('2026-04-15T12:34:56.789Z') → CH DateTime64(3) literal
 *  ('2026-04-15 12:34:56.789'). */
function pgCutoffToCh(iso: string): string {
  return iso.slice(0, 23).replace("T", " ");
}

/** Date → CH DateTime64(3) string. */
function chTimestamp(d: Date): string {
  return d.toISOString().slice(0, 23).replace("T", " ");
}
