/**
 * backfill-amm-fees.ts — One-time script to populate trading_fee for
 * existing amm_pools rows that don't have it yet.
 *
 * Queries each pool's live amm_info from XRPL to get the current fee.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-amm-fees.ts
 *
 * Re-running is safe — only updates rows where trading_fee IS NULL.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { ammPools } from "../src/db/schema";
import WebSocket from "ws";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
const db = drizzle(client, { schema });

const XRPL_NODES = [
  "wss://honeycluster.io",
  "wss://s2.ripple.com",
  "wss://xrplcluster.com",
  "wss://s1.ripple.com",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simple one-shot XRPL request via WebSocket */
async function xrplRequest(
  payload: Record<string, unknown>,
  nodeIndex = 0,
): Promise<Record<string, unknown>> {
  const nodeUrl = XRPL_NODES[nodeIndex % XRPL_NODES.length];

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(nodeUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout connecting to ${nodeUrl}`));
    }, 10_000);

    ws.on("open", () => {
      ws.send(JSON.stringify(payload));
    });

    ws.on("message", (data) => {
      clearTimeout(timeout);
      try {
        const parsed = JSON.parse(data.toString());
        ws.close();
        if (parsed.status === "error") {
          reject(new Error(parsed.error_message ?? parsed.error));
        } else {
          resolve(parsed.result ?? parsed);
        }
      } catch (err) {
        ws.close();
        reject(err);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main(): Promise<void> {
  console.log("=== Backfill AMM Trading Fees ===\n");

  // Find pools missing trading_fee
  const nullRows = await db
    .select({ account: ammPools.account })
    .from(ammPools)
    .where(sql`${ammPools.tradingFee} IS NULL`);

  if (nullRows.length === 0) {
    console.log("All pools already have trading_fee set. Nothing to do.");
    await client.end();
    return;
  }

  console.log(`Found ${nullRows.length} pools without trading_fee. Fetching from XRPL...\n`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < nullRows.length; i++) {
    const { account } = nullRows[i];
    try {
      const result = await xrplRequest({
        command: "amm_info",
        amm_account: account,
        ledger_index: "validated",
      });

      const amm = result.amm as { trading_fee?: number } | undefined;
      if (amm && typeof amm.trading_fee === "number") {
        await db
          .update(ammPools)
          .set({ tradingFee: amm.trading_fee })
          .where(sql`${ammPools.account} = ${account}`);
        updated++;
        console.log(`  [${i + 1}/${nullRows.length}] ${account} → fee=${amm.trading_fee}`);
      } else {
        console.warn(`  [${i + 1}/${nullRows.length}] ${account} → no fee in response`);
        failed++;
      }
    } catch (err) {
      console.warn(`  [${i + 1}/${nullRows.length}] ${account} → error:`, (err as Error).message);
      failed++;
    }

    // Rate limit: ~2 requests/sec
    if (i < nullRows.length - 1) await sleep(500);
  }

  console.log(`\nUpdated ${updated} pools, failed ${failed}.`);

  // Verify
  const [count] = await db.execute<{ total: number; withFee: number }>(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(trading_fee)::int AS "withFee"
    FROM amm_pools
  `);
  console.log(`Total pools: ${count.total}, with trading_fee: ${count.withFee}`);

  await client.end();
  console.log("Done!");
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await client.end();
  process.exit(1);
});
