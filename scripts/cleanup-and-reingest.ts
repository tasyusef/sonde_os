import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  console.log("=== Step 1: Truncate token_trades ===");
  await client`TRUNCATE token_trades`;
  console.log("  ✓ token_trades truncated");

  // Verify
  const [sizeAfter] = await client`SELECT pg_size_pretty(pg_database_size(current_database())) as size`;
  console.log("  DB size after truncate:", sizeAfter.size);

  // VACUUM to reclaim disk space
  console.log("\n=== Step 2: VACUUM FULL token_trades ===");
  await client.unsafe("VACUUM FULL token_trades");
  console.log("  ✓ VACUUM FULL complete");

  const [sizeVacuum] = await client`SELECT pg_size_pretty(pg_database_size(current_database())) as size`;
  console.log("  DB size after VACUUM:", sizeVacuum.size);

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
