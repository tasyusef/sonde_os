/**
 * Smart money scorer — external cron entry point.
 *
 * Runs the incremental scoring pipeline once and exits. Triggered by
 * Railway cron (every 6h). The pipeline's own job_state mutex prevents
 * overlapping runs if a trigger fires before the previous run finishes.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/run-smart-money-scorer.ts
 *
 * Requires DATABASE_URL and CLICKHOUSE_URL in the environment (.env.local
 * for local runs; set as Railway service variables in production).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  if (!process.env.CLICKHOUSE_URL) {
    console.error("CLICKHOUSE_URL required");
    process.exit(1);
  }

  const { runScoringPipeline } = await import("../src/lib/smart-money-scorer");

  const startedAt = Date.now();
  console.log(`[smart-money-scorer] starting at ${new Date().toISOString()}`);

  await runScoringPipeline();

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[smart-money-scorer] done in ${elapsed}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[smart-money-scorer] fatal:", err);
    process.exit(1);
  });
