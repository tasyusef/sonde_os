/**
 * Migration: create smart_money_scores and score_history tables.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-smart-money-scores.ts
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
  console.log("Creating smart money tables...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS smart_money_scores (
      address VARCHAR(35) PRIMARY KEY,
      composite_score NUMERIC(5, 2) NOT NULL,
      profitability_score NUMERIC(5, 2),
      roi_score NUMERIC(5, 2),
      win_rate_score NUMERIC(5, 2),
      consistency_score NUMERIC(5, 2),
      early_buyer_score NUMERIC(5, 2),
      smart_exit_score NUMERIC(5, 2),
      penalties JSONB,
      total_pnl_xrp NUMERIC(20, 2),
      total_trades INTEGER,
      win_rate NUMERIC(5, 2),
      sharpe_ratio NUMERIC(6, 3),
      tokens_traded INTEGER DEFAULT 0,
      wash_trading_flag BOOLEAN DEFAULT FALSE,
      scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("  [+] smart_money_scores");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sms_score
    ON smart_money_scores (composite_score DESC)
  `;
  console.log("  [+] idx_sms_score");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sms_scored_at
    ON smart_money_scores (scored_at)
  `;
  console.log("  [+] idx_sms_scored_at");

  await sql`
    CREATE TABLE IF NOT EXISTS score_history (
      id SERIAL PRIMARY KEY,
      address VARCHAR(35) NOT NULL,
      composite_score NUMERIC(5, 2) NOT NULL,
      scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("  [+] score_history");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sh_address
    ON score_history (address, scored_at DESC)
  `;
  console.log("  [+] idx_sh_address");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
