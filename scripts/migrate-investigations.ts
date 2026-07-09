/**
 * Migration: create investigation_sessions and investigation_messages tables.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-investigations.ts
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
  console.log("Creating investigation tables...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS investigation_sessions (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Investigation',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("  [+] investigation_sessions");

  await sql`
    CREATE TABLE IF NOT EXISTS investigation_messages (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("  [+] investigation_messages");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_investigation_messages_session
    ON investigation_messages (session_id, created_at ASC)
  `;
  console.log("  [+] index: investigation_messages(session_id, created_at)");

  console.log("\nMigration complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
