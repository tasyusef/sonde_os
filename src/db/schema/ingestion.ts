import { pgTable, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const ingestionState = pgTable("ingestion_state", {
  key: varchar("key", { length: 50 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const marketplaceRegistry = pgTable("marketplace_registry", {
  address: varchar("address", { length: 35 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  domain: varchar("domain", { length: 200 }),
  addedAt: timestamp("added_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
