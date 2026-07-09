import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  // Simulate what the "ALL" period marketplace query does
  const marketplaces = await client`
    SELECT marketplace, SUM(trade_count)::int as trades, SUM(xrp_volume_drops)::text as drops
    FROM nft_volume_daily
    WHERE marketplace != ''
    GROUP BY marketplace
    ORDER BY SUM(xrp_volume_drops) DESC
    LIMIT 5
  `;
  console.log("=== Top NFT Marketplaces (ALL) ===");
  for (const m of marketplaces) {
    const xrp = Number(BigInt(m.drops) / 1_000_000n);
    console.log(`  ${m.marketplace}: ${m.trades} trades, ${xrp.toLocaleString()} XRP`);
  }

  // Simulate 24h marketplace query  
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const marketplaces24h = await client`
    SELECT marketplace, SUM(trade_count)::int as trades, SUM(xrp_volume_drops)::text as drops
    FROM nft_volume_hourly
    WHERE hour >= ${cutoff} AND marketplace != ''
    GROUP BY marketplace
    ORDER BY SUM(xrp_volume_drops) DESC
    LIMIT 5
  `;
  console.log("\n=== Top NFT Marketplaces (24h) ===");
  if (marketplaces24h.length === 0) {
    console.log("  (empty — expected until new trades flow in)");
  }
  for (const m of marketplaces24h) {
    console.log(`  ${m.marketplace}: ${m.trades} trades`);
  }

  // Check volume table date range
  const [range] = await client`SELECT MIN(hour) as mn, MAX(hour) as mx FROM nft_volume_hourly`;
  console.log("\n=== NFT volume hourly range ===");
  console.log("  From:", range.mn);
  console.log("  To:", range.mx);
  console.log("  24h cutoff:", cutoff);
  
  // Check if epoch dates are gone
  const [epochRows] = await client`SELECT COUNT(*)::int as cnt FROM nft_volume_hourly WHERE hour < '2020-01-01'`;
  console.log("  Epoch-date rows:", epochRows.cnt, epochRows.cnt === 0 ? "✓" : "✗ BAD");

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
