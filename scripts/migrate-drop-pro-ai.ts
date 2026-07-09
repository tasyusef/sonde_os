/**
 * Migration: collapse any legacy `pro_ai` subscription rows into `pro`.
 *
 * Part of the Free + Pro pricing consolidation (2026-04-09).
 * Safe to run on empty DB. Safe to re-run. Idempotent.
 *
 * ⚠️ Pre-flight: verify no active pro_ai subscribers exist before running.
 * If any exist, they will be quietly migrated to the Pro tier (same feature
 * set, but new monthly query/investigation limits apply).
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-drop-pro-ai.ts
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
  console.log("Checking for legacy pro_ai subscriptions...\n");

  const before = await sql<{ tier: string; count: string }[]>`
    SELECT tier, count(*)::text AS count FROM subscriptions GROUP BY tier
  `;

  for (const row of before) {
    console.log(`  ${row.tier}: ${row.count}`);
  }

  const legacy = before.find((r) => r.tier === "pro_ai");
  if (!legacy || Number(legacy.count) === 0) {
    console.log("\nNo pro_ai rows. Nothing to migrate.");
    await sql.end();
    return;
  }

  console.log(`\nConverting ${legacy.count} pro_ai rows → pro...`);
  const result = await sql`UPDATE subscriptions SET tier = 'pro' WHERE tier = 'pro_ai'`;
  console.log(`  [+] ${result.count} rows updated`);

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
