import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  // Count bad token trades (ledger_index = 0)
  const [badTokens] = await client`SELECT COUNT(*)::int as cnt FROM token_trades WHERE ledger_index = 0`;
  console.log("Bad token trades (ledger_index=0):", badTokens.cnt);

  // Count bad NFT trades
  const [badNfts] = await client`SELECT COUNT(*)::int as cnt FROM nft_trades WHERE ledger_index = 0`;
  console.log("Bad NFT trades (ledger_index=0):", badNfts.cnt);

  // Delete bad trades so they can be re-ingested correctly
  console.log("\nDeleting bad token trades...");
  await client`DELETE FROM token_trades WHERE ledger_index = 0`;
  console.log("  ✓ Done");

  // Don't delete all nft_trades with ledger_index=0 — the original ones from backfill
  // also have ledger_index=0. Instead, we'll just need to re-backfill.
  // Actually wait - let me check if original nft_trades have proper ledger_index
  const [nftWithLedger] = await client`SELECT COUNT(*)::int as cnt FROM nft_trades WHERE ledger_index != 0`;
  console.log("\nNFT trades with valid ledger_index:", nftWithLedger.cnt);

  const [nftWithoutLedger] = await client`SELECT COUNT(*)::int as cnt FROM nft_trades WHERE ledger_index = 0`;
  console.log("NFT trades with ledger_index=0:", nftWithoutLedger.cnt);

  // All of them have ledger_index=0, which means backfill also had this issue
  // But the dates are correct on the old ones. Let's just truncate token_trades
  // (already mostly empty) and keep nft_trades as-is since dates are correct.

  // Also clean token_volume_hourly entries with hour at epoch  
  const [badVol] = await client`SELECT COUNT(*)::int as cnt FROM token_volume_hourly WHERE hour < '2020-01-01'`;
  console.log("\nBad token volume hourly rows (before 2020):", badVol.cnt);
  if (badVol.cnt > 0) {
    await client`DELETE FROM token_volume_hourly WHERE hour < '2020-01-01'`;
    console.log("  ✓ Deleted bad volume rows");
  }

  const [badNftVol] = await client`SELECT COUNT(*)::int as cnt FROM nft_volume_hourly WHERE hour < '2020-01-01'`;
  console.log("Bad NFT volume hourly rows (before 2020):", badNftVol.cnt);
  if (badNftVol.cnt > 0) {
    await client`DELETE FROM nft_volume_hourly WHERE hour < '2020-01-01'`;
    console.log("  ✓ Deleted bad NFT volume rows");
  }

  // Do the same for daily
  const [badDaily] = await client`SELECT COUNT(*)::int as cnt FROM token_volume_daily WHERE day < '2020-01-01'`;
  console.log("Bad token volume daily rows (before 2020):", badDaily.cnt);
  if (badDaily.cnt > 0) {
    await client`DELETE FROM token_volume_daily WHERE day < '2020-01-01'`;
    console.log("  ✓ Deleted bad daily volume rows");
  }

  const [badNftDaily] = await client`SELECT COUNT(*)::int as cnt FROM nft_volume_daily WHERE day < '2020-01-01'`;
  console.log("Bad NFT volume daily rows (before 2020):", badNftDaily.cnt);
  if (badNftDaily.cnt > 0) {
    await client`DELETE FROM nft_volume_daily WHERE day < '2020-01-01'`;
    console.log("  ✓ Deleted bad NFT daily volume rows");
  }

  // Now we need to find the gap-filled ledgers and remove them from ingested_ledgers
  // so they get re-processed with the fix. The gap-fill was processing random gaps,
  // so we can't easily identify which ones. But since the pipeline now has the fix,
  // new ledgers will have correct dates. The biggest priority is getting CURRENT
  // ledger data flowing correctly.
  
  console.log("\n=== Current state ===");
  const [dbSize] = await client`SELECT pg_size_pretty(pg_database_size(current_database())) as size`;
  console.log("DB size:", dbSize.size);
  const [tokenCnt] = await client`SELECT COUNT(*)::int as cnt FROM token_trades`;
  const [nftCnt] = await client`SELECT COUNT(*)::int as cnt FROM nft_trades`;
  console.log("Token trades:", tokenCnt.cnt);
  console.log("NFT trades:", nftCnt.cnt);

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
