/**
 * Migration: create page_views and api_errors tables for admin dashboard.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-admin.ts
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
  console.log("Creating admin tables...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS page_views (
      id BIGSERIAL PRIMARY KEY,
      route VARCHAR(200) NOT NULL,
      route_pattern VARCHAR(100) NOT NULL,
      visitor_hash VARCHAR(64) NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("  [+] page_views");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_page_views_pattern_time
    ON page_views (route_pattern, timestamp)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_page_views_time
    ON page_views (timestamp)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_page_views_visitor_time
    ON page_views (visitor_hash, timestamp)
  `;
  console.log("  [+] page_views indexes");

  await sql`
    CREATE TABLE IF NOT EXISTS api_errors (
      id SERIAL PRIMARY KEY,
      route VARCHAR(200) NOT NULL,
      error_message TEXT NOT NULL,
      stack_trace TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("  [+] api_errors");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_api_errors_time
    ON api_errors (timestamp)
  `;
  console.log("  [+] api_errors indexes");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
