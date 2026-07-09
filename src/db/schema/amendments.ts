import {
  pgTable,
  varchar,
  boolean,
  integer,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const amendments = pgTable("amendments", {
  hash: varchar("hash", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  firstSeen: timestamp("first_seen", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

export const amendmentVotes = pgTable(
  "amendment_votes",
  {
    amendmentHash: varchar("amendment_hash", { length: 64 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    yesCount: integer("yes_count").notNull().default(0),
    threshold: integer("threshold").notNull().default(0),
    totalValidators: integer("total_validators").notNull().default(0),
    hasMajority: boolean("has_majority").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.amendmentHash, t.recordedAt] }),
    index("idx_amendment_votes_time").on(t.recordedAt),
    index("idx_amendment_votes_hash").on(t.amendmentHash),
  ],
);
