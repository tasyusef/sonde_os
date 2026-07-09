/**
 * One-shot token price refresh — runs the same ClickHouse → Postgres
 * reconciliation that TokenPriceRefresher does, but exits when done.
 *
 * Useful for:
 *   • Backfilling `latest_price` after the migration (first deploy)
 *   • Manually kicking the refresher when debugging `/markets`
 *
 * Usage:
 *   pnpm tsx scripts/refresh-token-prices.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { tokenPriceRefresher } from "@/lib/token-price-refresher";

async function main() {
  // Trigger the same poll path the scheduler uses. Accessing the private
  // method via a typed cast is fine for a one-shot script.
  const r = tokenPriceRefresher as unknown as { poll: () => Promise<void> };
  const started = Date.now();
  await r.poll();
  console.log(`[refresh-token-prices] done in ${Date.now() - started}ms`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[refresh-token-prices] failed:", err);
  process.exit(1);
});
