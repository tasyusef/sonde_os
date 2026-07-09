/**
 * Migration: create job_state table for background manager scheduling and locking.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-job-state.ts
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
  console.log("Creating job_state table...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS job_state (
      job_name VARCHAR(50) PRIMARY KEY,
      status VARCHAR(20) NOT NULL DEFAULT 'idle',
      last_run_at TIMESTAMPTZ,
      next_run_at TIMESTAMPTZ,
      locked_until TIMESTAMPTZ,
      run_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      state_json JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("  [+] job_state");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
