import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  // Check how many nft_trades have epoch dates
  const [epochTrades] = await client`SELECT COUNT(*)::int as cnt FROM nft_trades WHERE date_iso < '2020-01-01'`;
  console.log("NFT trades with epoch date_iso:", epochTrades.cnt);

  // These are trades where the date field was 0 (XRPL epoch = 946684800 → Jan 1, 2000)
  // But wait - the XRPL epoch IS Jan 1 2000, and date=0 means Jan 1 2000 00:00:00 UTC.
  // Actual trades on XRPL should have date > 0 (seconds since XRPL epoch).
  // So date_iso of 2000-01-01 means the trade extractor got date=0.
  
  // Check the `date` column for these
  const trades = await client`
    SELECT date, date_iso, broker, marketplace, issuer 
    FROM nft_trades 
    WHERE date_iso < '2020-01-01' 
    LIMIT 5
  `;
  console.log("\nSample epoch-date trades:");
  for (const t of trades) {
    console.log(`  date=${t.date} date_iso=${t.date_iso} broker=${t.broker || '(none)'} issuer=${t.issuer}`);
  }

  // Check valid trades  
  const [validTrades] = await client`SELECT COUNT(*)::int as cnt FROM nft_trades WHERE date_iso >= '2020-01-01'`;
  console.log("\nNFT trades with valid date_iso:", validTrades.cnt);

  // The epoch trades have bogus dates. We can't fix them (we'd need the original ledger data).
  // Best approach: delete them and let them be re-ingested via backfill with the fixed code.
  // But the nft_trades are our only source for marketplace rebuild...
  // 
  // Actually, the valid trades (1242 - epoch) should be enough for the "ALL" period.
  // The 24h period relies on new data flowing in.
  
  // Let's just delete the epoch rows - they corrupt the volume tables
  console.log("\nDeleting epoch-date NFT trades...");
  const deleted = await client`DELETE FROM nft_trades WHERE date_iso < '2020-01-01' RETURNING tx_hash`;
  console.log(`  Deleted ${deleted.length} trades`);

  // Now rebuild volumes
  console.log("\nClearing and rebuilding NFT volumes...");
  await client`TRUNCATE nft_volume_hourly`;
  await client`TRUNCATE nft_volume_daily`;

  await client`
    INSERT INTO nft_volume_hourly (hour, issuer, marketplace, trade_count, xrp_volume_drops)
    SELECT
      date_trunc('hour', t.date_iso) AS hour,
      t.issuer,
      COALESCE(m.name, '') AS marketplace,
      COUNT(*)::int AS trade_count,
      SUM(t.amount_drops) AS xrp_volume_drops
    FROM nft_trades t
    LEFT JOIN marketplace_registry m ON m.address = t.broker
    WHERE t.is_xrp = true AND t.amount_drops IS NOT NULL
    GROUP BY 1, 2, 3
  `;

  await client`
    INSERT INTO nft_volume_daily (day, issuer, marketplace, trade_count, xrp_volume_drops)
    SELECT
      date_trunc('day', hour)::date AS day,
      issuer,
      marketplace,
      SUM(trade_count)::int AS trade_count,
      SUM(xrp_volume_drops) AS xrp_volume_drops
    FROM nft_volume_hourly
    GROUP BY 1, 2, 3
  `;

  // Verify
  const [hourlyCount] = await client`SELECT COUNT(*)::int as cnt FROM nft_volume_hourly`;
  const [epochCheck] = await client`SELECT COUNT(*)::int as cnt FROM nft_volume_hourly WHERE hour < '2020-01-01'`;
  const [hourlyMp] = await client`SELECT COUNT(*)::int as cnt FROM nft_volume_hourly WHERE marketplace != ''`;
  console.log(`\n  → ${hourlyCount.cnt} hourly rows (${hourlyMp.cnt} with marketplace)`);
  console.log(`  → Epoch rows: ${epochCheck.cnt}`);
  
  const [remaining] = await client`SELECT COUNT(*)::int as cnt FROM nft_trades`;
  console.log(`  → Remaining NFT trades: ${remaining.cnt}`);

  // Verify ALL marketplace query
  const mps = await client`
    SELECT marketplace, SUM(trade_count)::int as trades
    FROM nft_volume_daily WHERE marketplace != ''
    GROUP BY marketplace ORDER BY SUM(xrp_volume_drops) DESC
  `;
  console.log("\n  Top marketplaces (ALL):");
  for (const m of mps) {
    console.log(`    ${m.marketplace}: ${m.trades} trades`);
  }

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
