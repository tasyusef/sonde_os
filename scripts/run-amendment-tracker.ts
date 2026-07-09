/**
 * Amendment tracker cron entry point.
 *
 * Runs a single XRPL `feature` poll + persist + compaction, then
 * exits. Triggered by the Hetzner systemd timer
 * `sonde-amendment-tracker.timer` every 15 minutes.
 *
 * Replaces the in-process `setInterval` poller in
 * `src/lib/amendment-data.ts` — that pattern broke silently on
 * Railway when container recycles killed the timer between runs (same
 * bug that broke smart-money scoring + holder snapshots + portfolio
 * snapshots before their migrations).
 *
 * Compaction runs every invocation. The DELETE queries are bounded by
 * narrow time windows and are no-ops when there's nothing to drop, so
 * running them every 15 min costs nothing meaningful and saves us a
 * second timer.
 *
 * Usage (local):
 *   NODE_OPTIONS="--conditions react-server" pnpm tsx scripts/run-amendment-tracker.ts
 *
 * Requires DATABASE_URL in the environment (.env.local for local
 * runs; systemd EnvironmentFile in prod).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }

  const { runPollOnce, compactOnce } = await import("../src/lib/amendment-data");

  const startedAt = Date.now();
  console.log(`[amendment-tracker] starting at ${new Date().toISOString()}`);

  await runPollOnce();
  const pollElapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[amendment-tracker] poll done in ${pollElapsed}s`);

  const compactStart = Date.now();
  await compactOnce();
  const compactElapsed = ((Date.now() - compactStart) / 1000).toFixed(1);
  console.log(`[amendment-tracker] compact done in ${compactElapsed}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[amendment-tracker] fatal:", err);
    process.exit(1);
  });
