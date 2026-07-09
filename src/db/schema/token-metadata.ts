import {
  pgTable,
  varchar,
  integer,
  timestamp,
  numeric,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const tokenMetadata = pgTable(
  "token_metadata",
  {
    currency: varchar("currency", { length: 40 }).notNull(),
    issuer: varchar("issuer", { length: 35 }).notNull().default(""),
    name: varchar("name", { length: 100 }),
    icon: varchar("icon", { length: 2048 }),
    issuerName: varchar("issuer_name", { length: 100 }),
    holders: integer("holders"),
    trustlines: integer("trustlines"),
    latestPrice: numeric("latest_price"),
    latestPriceAt: timestamp("latest_price_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => [
    primaryKey({ columns: [t.currency, t.issuer] }),
    index("idx_token_meta_holders").on(t.holders),
    index("idx_token_meta_issuer").on(t.issuer),
  ],
);
