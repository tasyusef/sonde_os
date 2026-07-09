/**
 * Holder snapshot cron entry point.
 *
 * Runs a single holder-snapshot poll and exits. Triggered by Railway
 * cron every 4 hours. The pipeline's own job_state mutex prevents
 * overlapping runs if a trigger fires before the previous run
 * finishes.
 *
 * Replaces the in-process `setInterval` poller in
 * `src/lib/holder-snapshots.ts` — that pattern broke silently on
 * Railway when container recycles killed the timer between runs
 * (same bug that broke the smart-money scorer).
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/run-holder-snapshot.ts
 *
 * Requires DATABASE_URL and CLICKHOUSE_URL in the environment
 * (.env.local for local runs; Railway service variables in prod).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required (for job_state mutex)");
    process.exit(1);
  }
  if (!process.env.CLICKHOUSE_URL) {
    console.error("CLICKHOUSE_URL required (for snapshot writes)");
    process.exit(1);
  }

  const { runWithLock } = await import("../src/lib/holder-snapshots");

  const startedAt = Date.now();
  console.log(`[holder-snapshot] starting at ${new Date().toISOString()}`);

  const count = await runWithLock();

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (count === null) {
    console.log(`[holder-snapshot] skipped (lock held by another run) — ${elapsed}s`);
  } else {
    console.log(`[holder-snapshot] done — ${count} tokens snapshotted in ${elapsed}s`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[holder-snapshot] fatal:", err);
    process.exit(1);
  });
