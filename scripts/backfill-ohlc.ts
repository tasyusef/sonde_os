/**
 * Backfill OHLC columns from VWAP for existing token_volume rows.
 * Sets open=high=low=close = (xrp_volume_drops / 1e6) / volume
 * for all XRP-paired rows that don't yet have OHLC values.
 *
 * Usage: NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-ohlc.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

async function main() {
  console.log("[backfill-ohlc] Starting OHLC backfill from VWAP...");

  // Backfill hourly rows
  const h = await sql`
    UPDATE token_volume_hourly
    SET open_price  = (xrp_volume_drops::numeric / 1000000) / NULLIF(volume::numeric, 0),
        high_price  = (xrp_volume_drops::numeric / 1000000) / NULLIF(volume::numeric, 0),
        low_price   = (xrp_volume_drops::numeric / 1000000) / NULLIF(volume::numeric, 0),
        close_price = (xrp_volume_drops::numeric / 1000000) / NULLIF(volume::numeric, 0)
    WHERE open_price IS NULL
      AND pair_currency = 'XRP'
      AND volume::numeric > 0
      AND xrp_volume_drops > 0
  `;
  console.log(`[backfill-ohlc] Hourly rows updated: ${h.count}`);

  // Backfill daily rows
  const d = await sql`
    UPDATE token_volume_daily
    SET open_price  = (xrp_volume_drops::numeric / 1000000) / NULLIF(volume::numeric, 0),
        high_price  = (xrp_volume_drops::numeric / 1000000) / NULLIF(volume::numeric, 0),
        low_price   = (xrp_volume_drops::numeric / 1000000) / NULLIF(volume::numeric, 0),
        close_price = (xrp_volume_drops::numeric / 1000000) / NULLIF(volume::numeric, 0)
    WHERE open_price IS NULL
      AND pair_currency = 'XRP'
      AND volume::numeric > 0
      AND xrp_volume_drops > 0
  `;
  console.log(`[backfill-ohlc] Daily rows updated: ${d.count}`);

  // Show sample
  const sample = await sql`
    SELECT currency, hour::text AS ts, open_price::text AS price, volume::text AS vol
    FROM token_volume_hourly
    WHERE open_price IS NOT NULL AND pair_currency = 'XRP'
    ORDER BY hour DESC LIMIT 5
  `;
  console.log("[backfill-ohlc] Sample recent prices:");
  for (const r of sample) {
    console.log(`  ${r.currency}  ${r.ts}  price=${r.price}  vol=${r.vol}`);
  }

  await sql.end();
  console.log("[backfill-ohlc] Done!");
}

main().catch((err) => {
  console.error("[backfill-ohlc] Error:", err);
  sql.end().then(() => process.exit(1));
});
