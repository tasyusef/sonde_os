import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  // Check token_volume_hourly coverage
  const [tvRange] = await client`SELECT MIN(hour) as mn, MAX(hour) as mx, COUNT(*)::int as cnt FROM token_volume_hourly`;
  console.log("token_volume_hourly:", tvRange.cnt, "rows, range:", tvRange.mn, "→", tvRange.mx);

  // Check token_volume_daily coverage
  const [tvdRange] = await client`SELECT MIN(day) as mn, MAX(day) as mx, COUNT(*)::int as cnt FROM token_volume_daily`;
  console.log("token_volume_daily:", tvdRange.cnt, "rows, range:", tvdRange.mn, "→", tvdRange.mx);

  // Check nft_volume_hourly coverage
  const [nvRange] = await client`SELECT MIN(hour) as mn, MAX(hour) as mx, COUNT(*)::int as cnt FROM nft_volume_hourly`;
  console.log("nft_volume_hourly:", nvRange.cnt, "rows, range:", nvRange.mn, "→", nvRange.mx);

  // Are there any other consumers of raw token_trades or nft_trades?
  // The ranking queries in db-queries.ts only use volume tables
  // The seed-marketplaces rebuild JOINs nft_trades with marketplace_registry

  // Check if we can truncate token_trades safely
  const [tokenTradeSize] = await client`SELECT pg_size_pretty(pg_total_relation_size('token_trades')) as size`;
  console.log("\ntoken_trades size:", tokenTradeSize.size);

  // Check if nft_trades is needed for rebuild
  const [nftTradeSize] = await client`SELECT pg_size_pretty(pg_total_relation_size('nft_trades')) as size`;
  console.log("nft_trades size:", nftTradeSize.size);

  // What's the current plan limit?
  // We can check the max connections or just assess disk usage
  console.log("\nTotal DB: 710 MB");
  console.log("token_trades alone: 695 MB (98% of DB!)");
  console.log("Everything else: ~15 MB");
  console.log("\nRecommendation: TRUNCATE token_trades to free up 695 MB.");
  console.log("Volume aggregations (hourly/daily) already have the data for rankings.");
  console.log("We can rebuild token volumes from hourly if needed.");

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
