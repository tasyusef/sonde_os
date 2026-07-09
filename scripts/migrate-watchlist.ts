/**
 * Migration: create watchlist_items table for persistent address tracking.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-watchlist.ts
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
  console.log("Creating watchlist_items table...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS watchlist_items (
      id SERIAL PRIMARY KEY,
      user_address VARCHAR(35) NOT NULL,
      watched_address VARCHAR(35) NOT NULL,
      label TEXT,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("  [+] watchlist_items");

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_watchlist_user_watched
    ON watchlist_items (user_address, watched_address)
  `;
  console.log("  [+] uq_watchlist_user_watched unique index");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_watchlist_user
    ON watchlist_items (user_address)
  `;
  console.log("  [+] idx_watchlist_user index");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
