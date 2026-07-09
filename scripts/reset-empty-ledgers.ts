import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  // Find the last ledger that successfully wrote trades (before DB ran out of space)
  // NFT trades stop at March 3, 2026 19:05. Let's find what ledger that corresponds to.
  const [lastGoodNft] = await client`
    SELECT MAX(date) as max_date FROM nft_trades
  `;
  console.log("Last NFT trade XRPL date:", lastGoodNft.max_date);

  // The gap between March 3 and now (~8 days) = ~200K ledgers at ~3.5s/ledger
  // But we don't know exactly which ledger index corresponds to March 3.
  // Let's find ledgers that were ingested after the last good trade.
  
  // Find the approximate cutoff ledger - ledgers ingested around March 3
  // Based on our data: earliest=102623714, latest=102806098, total=74575 ingested
  // The range is ~182K ledgers. If the DB filled on March 3 (8 days ago),
  // and each day has ~22K ledgers (3.5s each), that's ~176K ledgers in the gap.
  // The cutoff is roughly around ledger 102623714 + (74575 - some_buffer)
  
  // Simpler approach: just count how many ingested_ledgers have NO corresponding trades
  const [totalIngested] = await client`SELECT COUNT(*)::int as cnt FROM ingested_ledgers`;
  console.log("\nTotal ingested ledgers:", totalIngested.cnt);

  // Find ledger ranges
  const [range] = await client`SELECT MIN(ledger_index) as mn, MAX(ledger_index) as mx FROM ingested_ledgers`;
  console.log("Range:", range.mn, "→", range.mx);

  // Since we know trades stopped on March 3 and the pipeline continued processing
  // ledgers after that (just couldn't write trades), we need to remove ledgers
  // that were processed after the DB filled up. These are the most recent ones.
  // 
  // Strategy: Delete ingested_ledgers that are in the range AFTER the last 
  // successfully written trade date. But we need the approximate ledger index.
  //
  // A simpler approach: Delete all ingested_ledgers except the earliest ~10K
  // (which have valid trade data). The gap-fill + live ingestion will handle the rest.
  // But gap-fill is too slow for 60K+ ledgers.
  //
  // Best approach: Just wipe ingested_ledgers for recent ones and run backfill.
  // Let me just count how many "empty" ledgers there are.
  
  // Count ledgers that have NO trades at all (neither NFT nor token)
  const [emptyEstimate] = await client`
    SELECT COUNT(*)::int as cnt 
    FROM ingested_ledgers il
    WHERE il.ledger_index > 102630000
      AND NOT EXISTS (SELECT 1 FROM nft_trades nt WHERE nt.ledger_index = il.ledger_index)
      AND NOT EXISTS (SELECT 1 FROM token_trades tt WHERE tt.ledger_index = il.ledger_index)
  `;
  console.log("\nLedgers >102630000 with no trades:", emptyEstimate.cnt);
  console.log("(Note: many ledgers legitimately have no trades)");

  // Since we can't distinguish between "no trades in ledger" and "trades dropped due to DB full",
  // the cleanest approach is to just delete ingested_ledger entries for the gap period
  // and re-process them via backfill. 
  //
  // The live pipeline (once fixed) will handle new ledgers going forward.
  // For the gap, we'll delete recent entries and let a forward-fill re-process.
  
  // For now, let's just make sure the LIVE pipeline will work for new data.
  // Delete ledgers ingested in the last few hours (since the truncate) that got
  // bad data, so they can be re-processed with the fix.
  const recentBad = await client`
    DELETE FROM ingested_ledgers 
    WHERE ledger_index > 102806000
    RETURNING ledger_index
  `;
  console.log(`\nDeleted ${recentBad.length} recently gap-filled ledgers (>102806000) for re-processing`);

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
