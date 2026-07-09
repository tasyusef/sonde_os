/**
 * Rename total_pnl_usd → total_pnl_xrp in smart_money_scores.
 * The column always stored XRP-denominated PnL, not USD.
 *
 * Run: NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-rename-pnl-column.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

const pg = postgres(process.env.DATABASE_URL!);

async function main() {
  // Check if old column exists
  const cols = await pg`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'smart_money_scores' AND column_name = 'total_pnl_usd'
  `;

  if (cols.length === 0) {
    console.log("Column total_pnl_usd not found — already renamed or table doesn't exist. Skipping.");
    await pg.end();
    return;
  }

  await pg`ALTER TABLE smart_money_scores RENAME COLUMN total_pnl_usd TO total_pnl_xrp`;
  console.log("Renamed smart_money_scores.total_pnl_usd → total_pnl_xrp");

  await pg.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
