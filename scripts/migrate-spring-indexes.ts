/**
 * Migration: add missing indexes identified during spring cleaning audit.
 *
 * These are all CREATE INDEX IF NOT EXISTS — safe to run multiple times.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-spring-indexes.ts
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
  console.log("Adding spring cleaning indexes...\n");

  // Smart money: time-range lookups by address
  console.log("  idx_sms_address_scored ...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sms_address_scored
    ON smart_money_scores (address, scored_at DESC)
  `;

  // Payment corridors: filter by source currency pair
  console.log("  idx_corridor_hourly_src ...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_corridor_hourly_src
    ON payment_corridor_hourly (src_currency, src_issuer)
  `;

  // Payment corridors: filter by destination currency pair
  console.log("  idx_corridor_hourly_dst ...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_corridor_hourly_dst
    ON payment_corridor_hourly (dst_currency, dst_issuer)
  `;

  // Wallet trade volume: hourly table missing wallet index
  // (daily already has wallet index, hourly only had hour index)
  console.log("  idx_wallet_trade_vol_hourly_wallet ...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_wallet_trade_vol_hourly_wallet
    ON wallet_trade_volume_hourly (wallet)
  `;

  // Wallet trade volume: daily table missing day index
  // (hourly already has hour index, daily only had wallet index)
  console.log("  idx_wallet_trade_vol_daily_day ...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_wallet_trade_vol_daily_day
    ON wallet_trade_volume_daily (day)
  `;

  // Token holder snapshots: DISTINCT ON (currency, issuer) ORDER BY snapshot_time DESC
  // Existing index is ASC — adding DESC variant for the supply lookup query (882ms avg)
  console.log("  idx_holder_snap_token_time_desc ...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_holder_snap_token_time_desc
    ON token_holder_snapshots (currency, issuer, snapshot_time DESC)
  `;

  console.log("\nDone — 6 indexes created (or already existed).");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
