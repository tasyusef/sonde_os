import { pgTable, varchar, bigint, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Per-account transaction counters — lifetime totals for tab labels and
 * overview stats. Updated incrementally by `intel-ingestion.ts` on every
 * batch; populated once from ClickHouse via `scripts/backfill-account-counters.ts`.
 *
 * `sent_count`     — txs submitted by this account (rawTx.Account === address)
 * `received_count` — txs with this account as Destination (Payment recipient).
 *                    Excludes self-payments (Account === Destination).
 *
 * Counts only include tx types with direct Account/Destination — i.e. what
 * rippled's account_tx returns as the "source" view. Txs that affect this
 * account only via AffectedNodes (e.g. DEX fills against someone else's
 * offer) are not counted here.
 *
 * fillfactor=85: this table gets a lot of HOT updates during ingestion.
 * Leaving in-page free space reduces bloat and vacuum pressure.
 */
export const accountTxCounts = pgTable(
  "account_tx_counts",
  {
    address: varchar("address", { length: 35 }).primaryKey(),
    sentCount: bigint("sent_count", { mode: "number" }).notNull().default(0),
    receivedCount: bigint("received_count", { mode: "number" }).notNull().default(0),
    firstSeenLedger: integer("first_seen_ledger"),
    lastSeenLedger: integer("last_seen_ledger"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_account_tx_counts_last_seen").on(t.lastSeenLedger)],
);
