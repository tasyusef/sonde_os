import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  // Total DB size
  const [dbSize] = await client`SELECT pg_size_pretty(pg_database_size(current_database())) as size`;
  console.log("Database size:", dbSize.size);

  // Table sizes
  const tables = await client`
    SELECT relname as table_name,
           pg_size_pretty(pg_total_relation_size(relid)) as total_size,
           pg_total_relation_size(relid) as raw_bytes,
           n_live_tup as row_count
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
  `;
  console.log("\n=== Table sizes ===");
  for (const t of tables) {
    console.log(`  ${t.table_name.padEnd(30)} ${t.total_size.padStart(12)}  (~${t.row_count} rows)`);
  }

  // Check latest token trade
  const [latestToken] = await client`SELECT MAX(date_iso) as mx FROM token_trades`;
  console.log("\nLatest token trade:", latestToken.mx);

  // Check latest NFT trade
  const [latestNft] = await client`SELECT MAX(date_iso) as mx FROM nft_trades`;
  console.log("Latest NFT trade:", latestNft.mx);

  // Check token trades since March 4
  const [tokenSinceMar4] = await client`SELECT COUNT(*)::int as cnt FROM token_trades WHERE date_iso >= '2026-03-04'`;
  console.log("Token trades since March 4:", tokenSinceMar4.cnt);

  // Check token volume hourly since March 4
  const [tokenVolSinceMar4] = await client`SELECT COUNT(*)::int as cnt FROM token_volume_hourly WHERE hour >= '2026-03-04'`;
  console.log("Token volume hourly since March 4:", tokenVolSinceMar4.cnt);

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
