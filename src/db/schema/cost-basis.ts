import { pgTable, varchar, numeric, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

/** Running weighted-average cost basis per account per token.
 *  Updated in real-time by the ingestion pipeline when a tracked
 *  account's token balance increases (DEX fill, payment, AMM, etc.).
 *  Avg cost computed on read: totalCostUsd / totalQtyAcquired.
 */
export const tokenCostBasis = pgTable(
  "token_cost_basis",
  {
    address: varchar("address", { length: 35 }).notNull(),
    currency: varchar("currency", { length: 40 }).notNull(),
    issuer: varchar("issuer", { length: 35 }).notNull(),
    /** Running sum of token quantity acquired */
    totalQtyAcquired: numeric("total_qty_acquired", { precision: 30, scale: 10 })
      .default("0")
      .notNull(),
    /** Running sum of XRP cost in drops across all acquisitions */
    totalCostDrops: numeric("total_cost_drops", { precision: 30, scale: 0 })
      .default("0")
      .notNull(),
    /** Running sum of USD cost across all acquisitions */
    totalCostUsd: numeric("total_cost_usd", { precision: 30, scale: 8 })
      .default("0")
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.address, t.currency, t.issuer] }),
    index("idx_cost_basis_address").on(t.address),
  ],
);
