/**
 * Migration: add visualization JSONB column to investigation_messages.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-investigation-viz.ts
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
  console.log("Adding visualization column to investigation_messages...\n");

  await sql`
    ALTER TABLE investigation_messages
    ADD COLUMN IF NOT EXISTS visualization JSONB
  `;
  console.log("  [+] visualization JSONB column added");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
