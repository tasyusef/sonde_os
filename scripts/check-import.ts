import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 3 });

async function run() {
  // Clean up bad rows from earlier buggy import (amounts were XRP * 1M instead of drops)
  const del = await client`DELETE FROM nft_trades WHERE amount_drops > 10000000000000`;
  if (Number(del.count) > 0) {
    console.log("Deleted", del.count, "rows with inflated amounts (> 10M XRP)");
  }

  const total = await client`SELECT COUNT(*)::int AS c FROM nft_trades`;
  console.log("Total nft_trades:", total[0].c);

  const sample = await client`SELECT tx_hash, amount_drops, marketplace, date_iso FROM nft_trades ORDER BY date_iso DESC LIMIT 5`;
  for (const r of sample) {
    const xrp = Number(r.amount_drops) / 1_000_000;
    console.log(`  ${String(r.tx_hash).slice(0, 12)}... ${xrp.toFixed(2)} XRP  mp=${r.marketplace}`);
  }

  // Check for suspiciously large amounts (> 10M XRP = 10T drops)
  const bad = await client`SELECT COUNT(*)::int AS c FROM nft_trades WHERE amount_drops > 10000000000000`;
  console.log("Rows with amount > 10M XRP (suspicious):", bad[0].c);

  // Token volumes
  const tokenTotal = await client`SELECT COUNT(*)::int AS c FROM token_volume_daily`;
  console.log("\nTotal token_volume_daily:", tokenTotal[0].c);

  await client.end();
}
run();
