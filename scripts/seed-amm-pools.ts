/**
 * seed-amm-pools.ts — Discover existing AMM pools from Bithomp and seed
 * the amm_pools table.
 *
 * One-time bootstrap — after initial seed, the ingestion pipeline
 * discovers new pools via AMMCreate transactions.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/seed-amm-pools.ts
 *
 * Re-running is safe (ON CONFLICT DO NOTHING).
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { ammPools } from "../src/db/schema";

const BITHOMP_BASE = "https://bithomp.com/api/v2";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const apiKey = process.env.BITHOMP_API_KEY;
if (!apiKey) {
  console.error("BITHOMP_API_KEY is required");
  process.exit(1);
}

const client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
const db = drizzle(client, { schema });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawAMM {
  ammID: string;
  account: string;
  amount: string; // XRP in drops
  amount2: {
    value: string;
    currency: string;
    issuer: string;
  };
  tradingFee: number;
  holders: number;
}

async function fetchAMMPools(): Promise<RawAMM[]> {
  const all: RawAMM[] = [];
  let marker: string | undefined;

  // Fetch all pools (paginated)
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      limit: "100",
      order: "updatedNew",
    });
    if (marker) params.set("marker", marker);

    try {
      const res = await fetch(`${BITHOMP_BASE}/amm?${params}`, {
        headers: { "x-bithomp-token": apiKey! },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn(`[seed] Bithomp /amm returned ${res.status}`);
        break;
      }

      const data = await res.json();
      const amms: RawAMM[] = (data?.amms ?? []).filter(
        (a: RawAMM) =>
          typeof a.amount === "string" &&
          a.amount2?.currency &&
          a.amount2?.issuer &&
          a.account,
      );

      if (amms.length === 0) break;
      all.push(...amms);
      console.log(`  Fetched ${all.length} pools so far...`);

      marker = data?.marker;
      if (!marker) break;

      await sleep(2000);
    } catch (err) {
      console.warn(`[seed] Error fetching AMM pools page ${page}:`, err);
      break;
    }
  }

  return all;
}

async function main(): Promise<void> {
  console.log("=== Seed AMM Pools ===\n");

  console.log("Fetching AMM pools from Bithomp...\n");
  const pools = await fetchAMMPools();

  if (pools.length === 0) {
    console.log("No AMM pools found.");
    await client.end();
    return;
  }

  console.log(`\nFound ${pools.length} AMM pools. Inserting...\n`);

  let inserted = 0;
  let skipped = 0;

  for (const pool of pools) {
    try {
      const result = await db
        .insert(ammPools)
        .values({
          account: pool.account,
          asset1Currency: "XRP",
          asset1Issuer: null,
          asset2Currency: pool.amount2.currency,
          asset2Issuer: pool.amount2.issuer,
          tradingFee: pool.tradingFee,
        })
        .onConflictDoUpdate({
          target: ammPools.account,
          set: { tradingFee: pool.tradingFee },
        })
        .returning({ account: ammPools.account });

      if (result.length > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.warn(`  Error inserting pool ${pool.account}:`, err);
    }
  }

  console.log(`Inserted ${inserted} new pools, skipped ${skipped} existing.\n`);

  // Verify
  const [count] = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM amm_pools
  `);
  console.log(`Total amm_pools rows: ${count.count}`);

  await client.end();
  console.log("Done!");
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await client.end();
  process.exit(1);
});
