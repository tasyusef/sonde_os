import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  // Check how many ledgers ingested
  const [total] = await client`SELECT COUNT(*)::int as cnt FROM ingested_ledgers`;
  console.log("Total ingested ledgers:", total.cnt);

  // Check recent ingested ledger range
  const [range] = await client`SELECT MIN(ledger_index) as mn, MAX(ledger_index) as mx FROM ingested_ledgers`;
  console.log("Ledger range:", range.mn, "→", range.mx);

  // Check token_trades for comparison
  const [tokenRange] = await client`SELECT MIN(executed_at) as mn, MAX(executed_at) as mx FROM token_trades`;
  console.log("\nToken trades range:", tokenRange.mn, "→", tokenRange.mx);

  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [tokenRecent] = await client`SELECT COUNT(*)::int as cnt FROM token_trades WHERE executed_at >= ${cutoff24h}`;
  console.log("Token trades in 24h:", tokenRecent.cnt);

  // Check if NFT trades exist after March 3
  const [nftAfterMar3] = await client`SELECT COUNT(*)::int as cnt FROM nft_trades WHERE date_iso >= '2026-03-04'`;
  console.log("\nNFT trades since March 4:", nftAfterMar3.cnt);

  // Check NFT volume hourly since March 3
  const [volAfterMar3] = await client`SELECT COUNT(*)::int as cnt FROM nft_volume_hourly WHERE hour >= '2026-03-04'`;
  console.log("NFT hourly volume rows since March 4:", volAfterMar3.cnt);

  // Check token volume hourly in 24h
  const [tokenVol24h] = await client`SELECT COUNT(*)::int as cnt FROM token_volume_hourly WHERE hour >= ${cutoff24h}`;
  console.log("Token hourly volume rows in 24h:", tokenVol24h.cnt);

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
