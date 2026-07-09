/**
 * Migration: create account_labels table for smart money classification.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-account-labels.ts
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
  console.log("Creating account_labels table...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS account_labels (
      address VARCHAR(35) NOT NULL,
      label VARCHAR(40) NOT NULL,
      confidence NUMERIC(4, 3) NOT NULL,
      evidence_json JSONB,
      scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (address, label)
    )
  `;
  console.log("  [+] account_labels");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_labels_label
    ON account_labels (label)
  `;
  console.log("  [+] idx_labels_label index");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_labels_scored_at
    ON account_labels (scored_at)
  `;
  console.log("  [+] idx_labels_scored_at index");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
