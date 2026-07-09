/**
 * Migration: add `model` column to ai_usage table.
 *
 * Tracks which LLM model generated each usage row so the admin dashboard
 * can break down token usage and cost by model. Backward-compatible —
 * existing rows will have NULL model (and the byModel aggregation handles
 * that gracefully).
 *
 * Must run BEFORE deploying Phase 2 code that inserts the model column.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-add-ai-usage-model.ts
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
  console.log("Adding model column to ai_usage...\n");

  await sql`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS model VARCHAR(50)`;
  console.log("  [+] ai_usage.model");

  await sql`CREATE INDEX IF NOT EXISTS idx_ai_usage_model ON ai_usage (model)`;
  console.log("  [+] idx_ai_usage_model");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
