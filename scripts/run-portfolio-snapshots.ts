/**
 * Portfolio snapshot cron entry point.
 *
 * Runs a single snapshot poll (every tracked account) plus compaction,
 * then exits. Triggered by the Hetzner systemd timer
 * `sonde-portfolio-snapshot.timer` every 5 minutes.
 *
 * Replaces the in-process `setInterval` poller in
 * `src/lib/portfolio-snapshots.ts` — that pattern broke silently on
 * Railway when container recycles killed the timer between runs (same
 * bug that broke the smart-money scorer + holder snapshots before
 * their migrations).
 *
 * Compaction runs every invocation. The DELETE queries are bounded by
 * narrow time windows and are no-ops when there's nothing to drop, so
 * running them every 5 min costs nothing meaningful and saves us a
 * second timer.
 *
 * Usage (local):
 *   NODE_OPTIONS="--conditions react-server" pnpm tsx scripts/run-portfolio-snapshots.ts
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

  const { runPollOnce, compactOnce } = await import("../src/lib/portfolio-snapshots");

  const startedAt = Date.now();
  console.log(`[portfolio-snapshots] starting at ${new Date().toISOString()}`);

  const { snapshotted, total } = await runPollOnce();
  const pollElapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[portfolio-snapshots] poll done — ${snapshotted}/${total} accounts in ${pollElapsed}s`,
  );

  const compactStart = Date.now();
  await compactOnce();
  const compactElapsed = ((Date.now() - compactStart) / 1000).toFixed(1);
  console.log(`[portfolio-snapshots] compact done in ${compactElapsed}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[portfolio-snapshots] fatal:", err);
    process.exit(1);
  });
