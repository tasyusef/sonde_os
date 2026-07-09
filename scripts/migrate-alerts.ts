/**
 * Migration: create alert_rules and alert_history tables.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-alerts.ts
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
  console.log("Creating alert tables...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id SERIAL PRIMARY KEY,
      user_address VARCHAR(35) NOT NULL,
      type VARCHAR(40) NOT NULL,
      conditions_json JSONB,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_triggered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("  [+] alert_rules");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_alert_rules_user_enabled
    ON alert_rules (user_address, enabled)
  `;
  console.log("  [+] idx_alert_rules_user_enabled");

  await sql`
    CREATE TABLE IF NOT EXISTS alert_history (
      id SERIAL PRIMARY KEY,
      rule_id INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
      triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payload_json JSONB,
      delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      delivery_channel VARCHAR(20) NOT NULL DEFAULT 'in_app',
      read_at TIMESTAMPTZ,
      retry_count INTEGER NOT NULL DEFAULT 0
    )
  `;
  console.log("  [+] alert_history");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_alert_history_rule_time
    ON alert_history (rule_id, triggered_at)
  `;
  console.log("  [+] idx_alert_history_rule_time");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_alert_history_status
    ON alert_history (delivery_status)
  `;
  console.log("  [+] idx_alert_history_status");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
