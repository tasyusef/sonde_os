import { pgTable, varchar, numeric, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/** Smart money composite scores — 0-100 weighted scoring across 6 factors.
 *
 *  Note: `score_history` (per-day score snapshots) was migrated to CH on
 *  2026-04-28. The smart-money scorer + the `/api/smart-money/[address]/history`
 *  route both read/write CH directly; the PG table was dropped 2026-05-09. */
export const smartMoneyScores = pgTable(
  "smart_money_scores",
  {
    address: varchar("address", { length: 35 }).primaryKey(),
    compositeScore: numeric("composite_score", { precision: 5, scale: 2 }).notNull(),
    profitabilityScore: numeric("profitability_score", { precision: 5, scale: 2 }),
    roiScore: numeric("roi_score", { precision: 5, scale: 2 }),
    winRateScore: numeric("win_rate_score", { precision: 5, scale: 2 }),
    consistencyScore: numeric("consistency_score", { precision: 5, scale: 2 }),
    earlyBuyerScore: numeric("early_buyer_score", { precision: 5, scale: 2 }),
    smartExitScore: numeric("smart_exit_score", { precision: 5, scale: 2 }),
    seasoningScore: numeric("seasoning_score", { precision: 5, scale: 2 }),
    penalties: jsonb("penalties"),
    totalPnlXrp: numeric("total_pnl_xrp", { precision: 20, scale: 2 }),
    totalTrades: integer("total_trades"),
    winRate: numeric("win_rate", { precision: 5, scale: 2 }),
    sharpeRatio: numeric("sharpe_ratio", { precision: 6, scale: 3 }),
    tokensTraded: integer("tokens_traded").default(0),
    washTradingFlag: boolean("wash_trading_flag").default(false),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_sms_score").on(t.compositeScore),
    index("idx_sms_scored_at").on(t.scoredAt),
  ],
);
