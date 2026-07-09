/**
 * Migration: create recent_ledgers table for performance heatmap seeding.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-recent-ledgers.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function main() {
  console.log("Creating recent_ledgers table...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS recent_ledgers (
      ledger_index INTEGER PRIMARY KEY,
      txn_count INTEGER NOT NULL,
      ledger_time INTEGER NOT NULL
    )
  `;
  console.log("  [+] recent_ledgers");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
