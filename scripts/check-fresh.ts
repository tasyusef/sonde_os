import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  // Latest 10 token trades with dates
  const latest = await client`
    SELECT date_iso, taker_gets_currency, taker_pays_currency, ledger_index 
    FROM token_trades 
    ORDER BY id DESC 
    LIMIT 10
  `;
  console.log("=== Latest 10 token trades ===");
  for (const t of latest) {
    console.log(`  ledger=${t.ledger_index}  date=${t.date_iso}  ${t.taker_gets_currency}/${t.taker_pays_currency}`);
  }

  // Latest 5 NFT trades
  const nftLatest = await client`
    SELECT date_iso, broker, marketplace, issuer, ledger_index 
    FROM nft_trades 
    ORDER BY date_iso DESC 
    LIMIT 5
  `;
  console.log("\n=== Latest 5 NFT trades ===");
  for (const t of nftLatest) {
    console.log(`  ledger=${t.ledger_index}  date=${t.date_iso}  broker=${t.broker || '(none)'}  mp=${t.marketplace || '(empty)'}  issuer=${t.issuer}`);
  }

  // Check token_volume_hourly - any entries after March 3?
  const volRecent = await client`
    SELECT hour, currency, trade_count, xrp_volume_drops 
    FROM token_volume_hourly 
    WHERE hour >= '2026-03-03' 
    ORDER BY hour DESC 
    LIMIT 10
  `;
  console.log("\n=== Token volume hourly (recent) ===");
  for (const v of volRecent) {
    console.log(`  hour=${v.hour}  ${v.currency}  trades=${v.trade_count}  xrp=${v.xrp_volume_drops}`);
  }

  // How many token trades now total?
  const [cnt] = await client`SELECT COUNT(*)::int as cnt FROM token_trades`;
  console.log("\nTotal token trades:", cnt.cnt);

  // DB size
  const [sz] = await client`SELECT pg_size_pretty(pg_database_size(current_database())) as size`;
  console.log("DB size:", sz.size);

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
