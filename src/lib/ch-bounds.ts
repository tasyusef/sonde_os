import "server-only";
import { query } from "./clickhouse-client";
import logger from "./logger";

const log = logger.child({ module: "ch-bounds" });

/**
 * In-memory cached lookup of the earliest timestamp + ledger present in
 * the CH `transactions` table. Used by the account-page status row to
 * surface "older history not indexed" honestly when an account's
 * lifetime history predates our retention window.
 *
 * Why cache: this query is cluster-wide constant — it doesn't depend on
 * the calling account, and shifts only when the CH cleanup timer drops
 * an old partition. A 1-hour TTL keeps the answer fresh enough without
 * pinning a CH RTT onto every counts request.
 *
 * `min(timestamp)` and `min(ledger_index)` over the full table are
 * granule-metadata queries — CH reads from `system.parts` minmax
 * indexes rather than scanning rows. Sub-millisecond on the live cluster.
 */

const TTL_MS = 60 * 60 * 1000;

let cached: ChBounds & { expiresAt: number } | null = null;

export interface ChBounds {
  /** CH `DateTime` literal — `YYYY-MM-DD HH:MM:SS`. */
  minTimestamp: string;
  minLedger: number;
}

export async function getChTransactionBounds(): Promise<ChBounds | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { minTimestamp: cached.minTimestamp, minLedger: cached.minLedger };
  }
  try {
    const rows = await query<{ ts: string; ledger: string }>(
      `SELECT toString(min(timestamp)) AS ts,
              toString(min(ledger_index)) AS ledger
       FROM transactions`,
    );
    const ts = rows[0]?.ts;
    const ledger = rows[0]?.ledger ? parseInt(rows[0].ledger, 10) : NaN;
    if (ts && Number.isFinite(ledger) && ledger > 0) {
      cached = {
        minTimestamp: ts,
        minLedger: ledger,
        expiresAt: now + TTL_MS,
      };
      return { minTimestamp: ts, minLedger: ledger };
    }
  } catch (err) {
    log.warn({ err }, "ch-bounds query failed");
  }
  return null;
}
