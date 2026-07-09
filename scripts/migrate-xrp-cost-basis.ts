/**
 * Migration: widen the realized PnL dedup index to include currency,
 * so a single transaction can produce both token and XRP PnL records.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-xrp-cost-basis.ts
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
  console.log("Dropping old dedup index (address, tx_hash)...");
  await sql`DROP INDEX IF EXISTS idx_realized_pnl_tx_dedup`;

  console.log("Deduplicating rows (keeping lowest id per address/tx_hash/currency)...");
  const deleted = await sql`
    DELETE FROM token_realized_pnl a
    USING token_realized_pnl b
    WHERE a.address = b.address
      AND a.tx_hash = b.tx_hash
      AND a.currency = b.currency
      AND a.id > b.id
  `;
  console.log(`Removed ${deleted.count} duplicate rows.`);

  console.log("Creating new dedup index (address, tx_hash, currency)...");
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_realized_pnl_tx_dedup
    ON token_realized_pnl (address, tx_hash, currency)
  `;

  console.log("Done.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
