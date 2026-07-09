/**
 * Migration: add wallet_address column to investigation_sessions.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-investigations-wallet.ts
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
  console.log("Adding wallet_address to investigation_sessions...\n");

  await sql`
    ALTER TABLE investigation_sessions
    ADD COLUMN IF NOT EXISTS wallet_address TEXT
  `;
  console.log("  [+] column: wallet_address");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_investigation_sessions_wallet
    ON investigation_sessions (wallet_address)
    WHERE wallet_address IS NOT NULL
  `;
  console.log("  [+] index: investigation_sessions(wallet_address)");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
