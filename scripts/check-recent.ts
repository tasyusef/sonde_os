import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  // Check ingestion state
  const state = await client`SELECT key, value, updated_at FROM ingestion_state ORDER BY key`;
  console.log("=== Ingestion state ===");
  for (const s of state) {
    console.log(`  ${s.key} = ${s.value} (${s.updated_at})`);
  }

  // Check very recent ledgers
  const [recentLedgers] = await client`SELECT COUNT(*)::int as cnt FROM ingested_ledgers WHERE ledger_index > 102806000`;
  console.log("\nRecent ingested ledgers (>102806000):", recentLedgers.cnt);

  // Check latest trades written
  const [latestNft] = await client`SELECT MAX(date_iso) as mx FROM nft_trades`;
  const [latestToken] = await client`SELECT MAX(date_iso) as mx FROM token_trades`;
  console.log("Latest NFT trade:", latestNft.mx);
  console.log("Latest token trade:", latestToken.mx);

  // Check total counts
  const [nftCount] = await client`SELECT COUNT(*)::int as cnt FROM nft_trades`;
  const [tokenCount] = await client`SELECT COUNT(*)::int as cnt FROM token_trades`;
  console.log("\nTotal NFT trades:", nftCount.cnt);
  console.log("Total token trades:", tokenCount.cnt);

  // Check nft_volume_hourly recent
  const [nvRecent] = await client`SELECT COUNT(*)::int as cnt FROM nft_volume_hourly WHERE hour >= NOW() - INTERVAL '1 hour'`;
  console.log("NFT volume hourly (last hour):", nvRecent.cnt);

  // Check token_volume_hourly recent
  const [tvRecent] = await client`SELECT COUNT(*)::int as cnt FROM token_volume_hourly WHERE hour >= NOW() - INTERVAL '1 hour'`;
  console.log("Token volume hourly (last hour):", tvRecent.cnt);

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
