/**
 * One-shot PG cleanup for the unified-ingester cutover.
 *
 *   - TRUNCATE account_tx_counts (rebuilt by live + backfill)
 *   - DELETE FROM ingested_ledgers WHERE ledger_index BETWEEN
 *       102822174 AND 103900000 (the bifurcated range)
 *   - DELETE FROM ingestion_state WHERE key = 'backfill_next_ledger'
 *   - UPDATE ingestion_state SET value = '<chain_tip>' for the three
 *     pointer keys (intel_latest_ledger / latest_ledger / earliest_ledger).
 *
 * Pass the chain tip as the first arg (e.g. 103859244).
 *
 * Usage:
 *   pnpm tsx scripts/refill-pg-reset.ts 103859244
 *
 * SAFE TO DELETE after the cutover lands.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function main() {
  const tipArg = process.argv[2];
  if (!tipArg || !/^\d+$/.test(tipArg)) {
    console.error("Usage: pnpm tsx scripts/refill-pg-reset.ts <chain_tip_ledger>");
    process.exit(1);
  }
  const chainTip = tipArg;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

  console.log(`PG refill — chain tip = ${chainTip}\n`);

  // Pre-state
  console.log("PRE STATE:");
  const preCounts = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM ingestion_state ORDER BY key
  `;
  for (const r of preCounts) console.log(`  ${r.key} = ${r.value}`);
  const preCtxs = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM account_tx_counts`;
  console.log(`  account_tx_counts rows = ${preCtxs[0].n}`);
  const preIngested = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ingested_ledgers WHERE ledger_index BETWEEN 102822174 AND 103900000
  `;
  console.log(`  ingested_ledgers rows in [102822174, 103900000] = ${preIngested[0].n}`);

  // Mutations
  console.log("\nMUTATIONS:");

  console.log("  TRUNCATE account_tx_counts");
  await sql`TRUNCATE TABLE account_tx_counts`;

  console.log("  DELETE FROM ingested_ledgers WHERE ledger_index BETWEEN 102822174 AND 103900000");
  await sql`DELETE FROM ingested_ledgers WHERE ledger_index BETWEEN 102822174 AND 103900000`;

  console.log("  DELETE FROM ingestion_state WHERE key = 'backfill_next_ledger'");
  await sql`DELETE FROM ingestion_state WHERE key = 'backfill_next_ledger'`;

  console.log(`  UPDATE ingestion_state SET value = '${chainTip}' WHERE key IN ('intel_latest_ledger','latest_ledger','earliest_ledger')`);
  await sql`
    UPDATE ingestion_state
    SET value = ${chainTip}, updated_at = now()
    WHERE key IN ('intel_latest_ledger', 'latest_ledger', 'earliest_ledger')
  `;

  // Post-state
  console.log("\nPOST STATE:");
  const postCounts = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM ingestion_state ORDER BY key
  `;
  for (const r of postCounts) console.log(`  ${r.key} = ${r.value}`);
  const postCtxs = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM account_tx_counts`;
  console.log(`  account_tx_counts rows = ${postCtxs[0].n}`);
  const postIngested = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ingested_ledgers WHERE ledger_index BETWEEN 102822174 AND 103900000
  `;
  console.log(`  ingested_ledgers rows in [102822174, 103900000] = ${postIngested[0].n}`);

  await sql.end();
  console.log("\nDONE");
}

main().catch((e) => { console.error(e); process.exit(1); });
