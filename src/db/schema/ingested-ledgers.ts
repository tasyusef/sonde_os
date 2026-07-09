import { pgTable, integer } from "drizzle-orm/pg-core";

export const ingestedLedgers = pgTable("ingested_ledgers", {
  ledgerIndex: integer("ledger_index").primaryKey(),
});
