import {
  pgTable,
  varchar,
  numeric,
  integer,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/** Accounts that have authenticated via wallet sign-in. */
export const trackedAccounts = pgTable("tracked_accounts", {
  address: varchar("address", { length: 35 }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSnapshot: timestamp("last_snapshot", { withTimezone: true }),
});

/** Periodic portfolio balance snapshots (every 4h, compacted over time). */
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    snapshotTime: timestamp("snapshot_time", { withTimezone: true }).notNull(),
    address: varchar("address", { length: 35 })
      .notNull()
      .references(() => trackedAccounts.address, { onDelete: "cascade" }),
    xrpBalance: numeric("xrp_balance", { precision: 30, scale: 10 }),
    xrpPriceUsd: numeric("xrp_price_usd", { precision: 20, scale: 8 }),
    tokenValueUsd: numeric("token_value_usd", { precision: 20, scale: 8 }),
    nftCount: integer("nft_count"),
    ammValueUsd: numeric("amm_value_usd", { precision: 20, scale: 8 }),
    lockedXrp: numeric("locked_xrp", { precision: 30, scale: 10 }),
    totalValueUsd: numeric("total_value_usd", { precision: 20, scale: 8 }),
    tokenBreakdown: jsonb("token_breakdown"),
    ownerCount: integer("owner_count"),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotTime, t.address] }),
    index("idx_portfolio_snap_addr_time").on(t.address, t.snapshotTime),
  ],
);

/** JWT session tracking — allows revocation + cleanup. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    address: varchar("address", { length: 35 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_auth_sessions_address").on(t.address),
    index("idx_auth_sessions_expires").on(t.expiresAt),
  ],
);
