/**
 * Drop and recreate dex_trades + wallet_token_pnl tables, then reset
 * the intel ingestion pointer so data re-ingests with correct prices.
 *
 * Run AFTER applying the drops→XRP fix in intel-ingestion.ts.
 * Run BEFORE restarting the app (which triggers re-ingestion).
 *
 * Usage:
 *   export $(grep CLICKHOUSE_URL .env.local | xargs)
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/reset-dex-trades.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import postgres from "postgres";

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
if (!CLICKHOUSE_URL) {
  console.error("CLICKHOUSE_URL not set");
  process.exit(1);
}

const DATABASE = "sonde";
const ch = createClient({ url: CLICKHOUSE_URL, database: DATABASE });
const pg = postgres(process.env.DATABASE_URL!);

async function main() {
  console.log("Resetting dex_trades for clean re-ingestion...\n");

  // 1. Drop ClickHouse tables that need rebuilding
  console.log("[1/4] Dropping dex_trades...");
  await ch.command({ query: `DROP TABLE IF EXISTS ${DATABASE}.dex_trades` });
  console.log("  dropped.");

  console.log("[2/4] Dropping wallet_token_pnl...");
  await ch.command({ query: `DROP TABLE IF EXISTS ${DATABASE}.wallet_token_pnl` });
  console.log("  dropped.");

  // 3. Recreate tables via setup-clickhouse (import and run)
  console.log("[3/4] Recreating tables via setup-clickhouse...");
  const { execSync } = await import("child_process");
  execSync("npx tsx scripts/setup-clickhouse.ts", {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, CLICKHOUSE_URL },
  });

  // 4. Reset intel ingestion pointer to re-process all ledgers
  console.log("[4/4] Resetting intel ingestion pointer...");
  const current = await pg`
    SELECT value FROM ingestion_state WHERE key = 'intel_latest_ledger'
  `;
  if (current.length > 0) {
    console.log(`  Current pointer: ledger ${current[0].value}`);
  }

  // Set pointer to 0 so the intel pipeline re-ingests from the earliest
  // available ledger in ingested_ledgers
  await pg`
    UPDATE ingestion_state SET value = '0', updated_at = NOW()
    WHERE key = 'intel_latest_ledger'
  `;
  console.log("  Pointer reset to 0 — intel pipeline will re-ingest all ledgers.\n");

  // Also clear smart money scores since they're derived from bad data
  console.log("Clearing smart_money_scores and score_history...");
  await pg`TRUNCATE smart_money_scores CASCADE`;
  await pg`TRUNCATE score_history CASCADE`;
  console.log("  Cleared.\n");

  console.log("Done. Next steps:");
  console.log("  1. Restart the app — intel pipeline will begin re-ingesting");
  console.log("  2. Once re-ingestion catches up, run: NODE_OPTIONS=\"--conditions react-server\" npx tsx scripts/backfill-smart-money.ts");

  await ch.close();
  await pg.end();
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
