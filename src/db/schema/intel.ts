import { pgTable, serial, bigserial, varchar, text, timestamp, uniqueIndex, index, numeric, jsonb, primaryKey } from "drizzle-orm/pg-core";

/** Account labels — smart money classification */
export const accountLabels = pgTable(
  "account_labels",
  {
    address: varchar("address", { length: 35 }).notNull(),
    label: varchar("label", { length: 40 }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(), // 0.000–1.000
    evidenceJson: jsonb("evidence_json"),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.address, t.label] }),
    index("idx_labels_label").on(t.label),
    index("idx_labels_scored_at").on(t.scoredAt),
  ],
);

/** Watchlist items — persistent per-user address tracking */
export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: serial("id").primaryKey(),
    userAddress: varchar("user_address", { length: 35 }).notNull(),
    watchedAddress: varchar("watched_address", { length: 35 }).notNull(),
    label: text("label"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_watchlist_user_watched").on(t.userAddress, t.watchedAddress),
    index("idx_watchlist_user").on(t.userAddress),
  ],
);

/**
 * /asktheledger query history — per-user persistent log of natural-language
 * questions and the responses they got. Used to populate the "Recent"
 * section above the empty state on the chat page so users can re-open
 * past answers without re-querying.
 *
 * Stores the full structured payload (visualization / stat / table) as
 * JSONB so opening a history item is instant and shows the answer
 * exactly as it was originally rendered. New queries always run fresh
 * regardless.
 */
export const asktheledgerHistory = pgTable(
  "asktheledger_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userAddress: varchar("user_address", { length: 35 }).notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    store: varchar("store", { length: 16 }),
    query: text("query"),
    visualization: jsonb("visualization"),
    statValue: jsonb("stat_value"),
    tableData: jsonb("table_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_asktheledger_history_user").on(t.userAddress, t.createdAt),
  ],
);
