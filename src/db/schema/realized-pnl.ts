import { pgTable, serial, varchar, numeric, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/** Per-sale realized PnL records for tracked accounts.
 *  Inserted by the ingestion pipeline when a tracked account's
 *  token balance decreases via a DEX fill (OfferCreate).
 *  Cost basis is computed using weighted-average from tokenCostBasis.
 */
export const tokenRealizedPnl = pgTable(
  "token_realized_pnl",
  {
    id: serial("id").primaryKey(),
    address: varchar("address", { length: 35 }).notNull(),
    currency: varchar("currency", { length: 40 }).notNull(),
    issuer: varchar("issuer", { length: 35 }).notNull(),
    /** Quantity of token sold/disposed */
    qtySold: numeric("qty_sold", { precision: 30, scale: 10 }).notNull(),
    /** WAVG cost basis of disposed tokens (USD) */
    costBasisUsd: numeric("cost_basis_usd", { precision: 20, scale: 8 }).notNull(),
    /** Sale proceeds in USD (XRP received × price at time of sale) */
    proceedsUsd: numeric("proceeds_usd", { precision: 20, scale: 8 }).notNull(),
    /** Realized PnL = proceeds - costBasis */
    pnlUsd: numeric("pnl_usd", { precision: 20, scale: 8 }).notNull(),
    txHash: varchar("tx_hash", { length: 64 }).notNull(),
    ledgerIndex: integer("ledger_index").notNull(),
    realizedAt: timestamp("realized_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_realized_pnl_address").on(t.address),
    index("idx_realized_pnl_token").on(t.address, t.currency, t.issuer),
    uniqueIndex("idx_realized_pnl_tx_dedup").on(t.address, t.txHash, t.currency),
  ],
);
