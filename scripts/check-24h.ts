import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Check nft_volume_hourly
  const [hourlyRange] = await client`SELECT MIN(hour) as mn, MAX(hour) as mx FROM nft_volume_hourly`;
  const [hourly24h] = await client`SELECT COUNT(*)::int as cnt FROM nft_volume_hourly WHERE hour >= ${cutoff}`;
  const [hourly24hMp] = await client`SELECT COUNT(*)::int as cnt FROM nft_volume_hourly WHERE hour >= ${cutoff} AND marketplace != ''`;

  console.log("=== nft_volume_hourly ===");
  console.log("  Range:", hourlyRange.mn, "→", hourlyRange.mx);
  console.log("  24h cutoff:", cutoff);
  console.log("  Rows in 24h (all):", hourly24h.cnt);
  console.log("  Rows in 24h (with marketplace):", hourly24hMp.cnt);

  // Check recent nft_trades
  const [tradesRange] = await client`SELECT MIN(date_iso) as mn, MAX(date_iso) as mx FROM nft_trades`;
  const [trades24h] = await client`SELECT COUNT(*)::int as cnt FROM nft_trades WHERE date_iso >= ${cutoff}`;

  console.log("\n=== nft_trades ===");
  console.log("  Range:", tradesRange.mn, "→", tradesRange.mx);
  console.log("  Trades in 24h:", trades24h.cnt);

  // Show latest 5 trades
  const latest = await client`SELECT date_iso, broker, marketplace, issuer FROM nft_trades ORDER BY date_iso DESC LIMIT 5`;
  console.log("\n=== Latest 5 trades ===");
  for (const t of latest) {
    console.log(`  ${t.date_iso}  broker=${t.broker || '(none)'}  mp=${t.marketplace || '(empty)'}  issuer=${t.issuer}`);
  }

  // Check ingestion state
  const state = await client`SELECT key, value, updated_at FROM ingestion_state ORDER BY key`;
  console.log("\n=== Ingestion state ===");
  for (const s of state) {
    console.log(`  ${s.key} = ${s.value} (${s.updated_at})`);
  }

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
