import { pgTable, varchar, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const ammPools = pgTable(
  "amm_pools",
  {
    account: varchar("account", { length: 35 }).primaryKey(),
    asset1Currency: varchar("asset1_currency", { length: 40 }).notNull(),
    asset1Issuer: varchar("asset1_issuer", { length: 35 }),
    asset2Currency: varchar("asset2_currency", { length: 40 }).notNull(),
    asset2Issuer: varchar("asset2_issuer", { length: 35 }),
    tradingFee: integer("trading_fee"),
    /** Cached TVL in XRP (both sides of the pool combined, XRP-side × 2).
     *  Updated by AmmPoolTvlRefresher every few minutes. NULL until first refresh. */
    tvlXrp: numeric("tvl_xrp", { precision: 30, scale: 6 }),
    tvlUpdatedAt: timestamp("tvl_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => [
    index("idx_amm_asset1").on(t.asset1Currency, t.asset1Issuer),
    index("idx_amm_asset2").on(t.asset2Currency, t.asset2Issuer),
    index("idx_amm_pools_tvl").on(t.tvlXrp),
  ],
);
