/**
 * Diagnostic: check whether the `dex_trades` drops-vs-XRP bug (pre-2026-04-09)
 * is still present in data.
 *
 * Context: before the code fix, XRP-sided quote_amount was stored in drops
 * instead of XRP. A 5 XRP quote got stored as 5,000,000, making prices
 * 1,000,000x inflated. Fix in code landed 2026-04-09. A targeted cleanup
 * script (`scripts/cleanup-corrupt-dex-trades.ts`) removed the known-corrupt
 * pre-fix rows on 2026-04-22.
 *
 * Detection uses the ratio quote_amount * 1,000,000 / xrp_volume_drops:
 *   - ≈ 1.0 means quote_amount is in XRP (correct)
 *   - ≈ 1,000,000 means quote_amount is in drops (buggy)
 *
 * The previous version of this script used `price > 10,000` as a threshold,
 * which produced false positives on legitimate BTC-XRP trades (BTC really is
 * worth ~46,000 XRP). Use the ratio-based predicate instead.
 *
 * Usage:
 *   pnpm tsx scripts/check-dex-trades-drops-bug.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@clickhouse/client";

config({ path: ".env.local" });

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const DATABASE = process.env.CLICKHOUSE_DATABASE ?? "sonde";

// Corrupt-row signature: quote_amount is stored in drops instead of XRP,
// so quote_amount ≈ xrp_volume_drops (for correct rows, quote_amount * 1M
// ≈ xrp_volume_drops, so quote_amount is 1/1,000,000 the size).
const CORRUPT_PREDICATE = `
  quote_currency = 'XRP'
  AND xrp_volume_drops > 0
  AND quote_amount > xrp_volume_drops * 0.5
`;

async function queryRows<T>(
  client: ReturnType<typeof createClient>,
  query: string,
): Promise<T[]> {
  const result = await client.query({ query, format: "JSONEachRow" });
  return result.json<T>();
}

async function main() {
  const client = createClient({
    url: CLICKHOUSE_URL,
    database: DATABASE,
    request_timeout: 30_000,
  });

  console.log(`ClickHouse: ${new URL(CLICKHOUSE_URL).host}`);
  console.log(`Database: ${DATABASE}\n`);

  // 1. Totals
  const totalsRows = await queryRows<{
    total: string;
    xrp_quoted: string;
    xrp_based: string;
  }>(
    client,
    `SELECT
       count() AS total,
       countIf(quote_currency = 'XRP') AS xrp_quoted,
       countIf(base_currency = 'XRP') AS xrp_based
     FROM dex_trades`,
  );
  const totals = totalsRows[0];

  console.log("=== dex_trades row counts ===");
  console.log(`  Total rows:         ${Number(totals.total).toLocaleString()}`);
  console.log(`  XRP as quote side:  ${Number(totals.xrp_quoted).toLocaleString()}`);
  console.log(`  XRP as base side:   ${Number(totals.xrp_based).toLocaleString()}\n`);

  // 2. Pre-fix vs post-fix corruption count (ratio-based predicate).
  const eraRows = await queryRows<{
    era: string;
    total: string;
    corrupt: string;
  }>(
    client,
    `SELECT
       if(timestamp < '2026-04-09 00:00:00', 'pre-fix', 'post-fix') AS era,
       count() AS total,
       countIf(${CORRUPT_PREDICATE}) AS corrupt
     FROM dex_trades
     WHERE quote_currency = 'XRP'
     GROUP BY era
     ORDER BY era`,
  );

  console.log("=== Corruption by era (ratio-based predicate) ===\n");
  for (const r of eraRows) {
    const total = Number(r.total);
    const corrupt = Number(r.corrupt);
    const pct = total > 0 ? ((corrupt / total) * 100).toFixed(2) : "0.00";
    const marker = corrupt === 0 ? "✅" : "❌";
    console.log(
      `  ${marker} ${r.era.padEnd(10)}  n=${total.toLocaleString().padStart(8)}  corrupt=${corrupt.toLocaleString().padStart(7)}  (${pct}%)`,
    );
  }
  console.log();

  const postFixCorrupt = Number(
    eraRows.find((r) => r.era === "post-fix")?.corrupt ?? "0",
  );
  const preFixCorrupt = Number(
    eraRows.find((r) => r.era === "pre-fix")?.corrupt ?? "0",
  );

  if (postFixCorrupt > 0) {
    console.log("⚠️  Post-fix corrupt rows present — code fix may have gaps. Investigate.\n");
  } else if (preFixCorrupt > 0) {
    console.log("→ Pre-fix corrupt rows remain. Run scripts/cleanup-corrupt-dex-trades.ts.\n");
  } else {
    console.log("✅ dex_trades is clean across both eras.\n");
  }

  // 3. Validation: verify the ratio check across a representative sample of
  // post-fix XRP-quoted rows. Should be near 1.0 everywhere.
  const ratioStats = await queryRows<{
    avg_ratio: number;
    min_ratio: number;
    max_ratio: number;
  }>(
    client,
    `SELECT
       round(avg(quote_amount * 1000000 / xrp_volume_drops), 4) AS avg_ratio,
       round(min(quote_amount * 1000000 / xrp_volume_drops), 4) AS min_ratio,
       round(max(quote_amount * 1000000 / xrp_volume_drops), 4) AS max_ratio
     FROM dex_trades
     WHERE quote_currency = 'XRP'
       AND xrp_volume_drops > 0
       AND timestamp >= '2026-04-09 00:00:00'`,
  );

  const r = ratioStats[0];
  console.log("=== Post-fix ratio sanity (quote_amount * 1M / xrp_volume_drops) ===");
  console.log(`  avg: ${r.avg_ratio}   min: ${r.min_ratio}   max: ${r.max_ratio}`);
  console.log("  (all values should be ≈ 1.0 if the code fix is in effect)\n");

  // 4. Sanity check: top realized PnL in wallet_token_pnl.
  const topPnl = await queryRows<{
    wallet: string;
    realized_pnl: number;
    total_cost: number;
    xrp_volume: number;
  }>(
    client,
    `SELECT
       wallet,
       round(realized_pnl, 2) AS realized_pnl,
       round(total_cost, 2) AS total_cost,
       round(xrp_volume_drops / 1000000, 2) AS xrp_volume
     FROM wallet_token_pnl FINAL
     WHERE realized_pnl > 0
     ORDER BY realized_pnl DESC
     LIMIT 5`,
  );

  console.log("=== Top 5 realized PnL in wallet_token_pnl ===");
  console.log("    (sanity check — values should look like reasonable XRP amounts)\n");
  for (const row of topPnl) {
    const walletTrunc = row.wallet.slice(0, 12) + "...";
    console.log(
      `    ${walletTrunc.padEnd(16)}  pnl=${row.realized_pnl.toLocaleString().padStart(18)}  cost=${row.total_cost.toLocaleString().padStart(16)}  vol=${row.xrp_volume.toLocaleString().padStart(16)} XRP`,
    );
  }
  console.log();

  if (topPnl.length > 0 && topPnl[0].realized_pnl > 1_000_000_000) {
    console.log("⚠️  Top PnL exceeds 1 billion — check for remaining corruption.");
  } else {
    console.log("✅ Top PnL values look plausible for XRPL trading.");
  }

  await client.close();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
