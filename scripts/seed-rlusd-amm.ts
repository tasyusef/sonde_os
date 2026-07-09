/**
 * One-off: seed the RLUSD/XRP AMM pool into amm_pools so it ranks correctly
 * on the Top Liquidity Pools card. Our ingestion only sees AMMCreate txs
 * going forward; this pool predates ingestion.
 *
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING.
 *
 * Usage: npx tsx scripts/seed-rlusd-amm.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[seed-rlusd] DATABASE_URL required");
  process.exit(1);
}

const RLUSD_CURRENCY = "524C555344000000000000000000000000000000"; // "RLUSD" padded
const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const RLUSD_AMM_ACCOUNT = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";
const TRADING_FEE_BPS = 223; // 0.223%

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const result = await sql`
      INSERT INTO amm_pools (
        account,
        asset1_currency, asset1_issuer,
        asset2_currency, asset2_issuer,
        trading_fee
      )
      VALUES (
        ${RLUSD_AMM_ACCOUNT},
        ${"XRP"}, ${null},
        ${RLUSD_CURRENCY}, ${RLUSD_ISSUER},
        ${TRADING_FEE_BPS}
      )
      ON CONFLICT (account) DO NOTHING
      RETURNING account
    `;

    if (result.length === 0) {
      console.log("[seed-rlusd] already seeded — skipping insert");
    } else {
      console.log(`[seed-rlusd] inserted RLUSD/XRP AMM pool (${result[0].account})`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[seed-rlusd] fatal:", err);
  process.exit(1);
});
