/**
 * Seed the marketplace_registry with known XRPL NFT marketplace broker addresses.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/seed-marketplaces.ts
 *
 * Re-running is safe (ON CONFLICT DO UPDATE).
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "../src/db/schema";

/* ------------------------------------------------------------------ */
/*  Database connection                                                */
/* ------------------------------------------------------------------ */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
const db = drizzle(client, { schema });

/* ------------------------------------------------------------------ */
/*  Known XRPL NFT marketplace broker addresses                        */
/* ------------------------------------------------------------------ */

const KNOWN_MARKETPLACES: { address: string; name: string; domain: string }[] = [
  { address: "rpx9JThQ2y37FaGeeJP7PXDUVEXY3PHZSC", name: "xrp.cafe", domain: "xrp.cafe" },
  { address: "rpZqTPC8GvrSvEfFsUuHkmPCg29GdQuXhC", name: "nft.onxrp.com", domain: "nft.onxrp.com" },
];

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("=== Seed Marketplace Registry ===\n");

  let inserted = 0;
  let updated = 0;

  for (const mp of KNOWN_MARKETPLACES) {
    const result = await db.execute(sql`
      INSERT INTO marketplace_registry (address, name, domain)
      VALUES (${mp.address}, ${mp.name}, ${mp.domain})
      ON CONFLICT (address) DO UPDATE
        SET name = EXCLUDED.name,
            domain = EXCLUDED.domain
      RETURNING (xmax = 0) AS is_insert
    `);

    const row = result[0] as { is_insert: boolean } | undefined;
    if (row?.is_insert) {
      inserted++;
      console.log(`  + ${mp.name} (${mp.address})`);
    } else {
      updated++;
      console.log(`  ~ ${mp.name} (${mp.address}) — updated`);
    }
  }

  console.log(`\nSeeded ${inserted} new, updated ${updated} existing.`);

  await client.end();
  console.log("Done!");
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await client.end();
  process.exit(1);
});
