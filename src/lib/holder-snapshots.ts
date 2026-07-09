/**
 * Holder snapshot writer + compactor.
 *
 * Writes top-10 holder snapshots for actively-traded tokens to
 * ClickHouse `token_holder_snapshots` (migrated from PG 2026-04-28).
 *
 * **Execution model:** The polling loop is no longer a long-lived
 * `setInterval` inside the Next.js server — that pattern broke
 * silently on Railway when container recycles killed the timer (same
 * bug that broke the smart-money scorer). Instead, `runOnce()` is
 * called from `scripts/run-holder-snapshot.ts` on a Railway cron
 * (`0` slash-asterisk-4 ` * * *` — every 4 hours). The `job_state`
 * row provides cross-process mutex + observability for overlapping
 * triggers.
 *
 * Compaction (deleting old rows to reduce footprint) lives in CH's
 * partition lifecycle — partitions are monthly, so older months can
 * be dropped wholesale via `ALTER TABLE ... DROP PARTITION` in a
 * separate retention job. The PG-era per-row DELETEs aren't a great
 * fit for ClickHouse's MergeTree storage; partition-drop retention
 * is added in a follow-up if/when storage becomes a concern.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fetchTopHolders } from "./holder-data";
import { getIngestionClient } from "./ingestion";
import { query as chQuery, insert as chInsert } from "@/lib/clickhouse-client";
import logger from "@/lib/logger";

const JOB_NAME = "holder_snapshot";
/** Lock TTL. First production run came in at 1h 41min — 60 min was
 *  cutting it dangerously close (the lock would expire while the run
 *  was still in flight, letting a later cron tick start a parallel
 *  run). 120 min gives ~20 min of headroom over the observed wall
 *  time and still well under the 4-hour cron cadence. */
const LOCK_DURATION_MS = 120 * 60 * 1000;

/** How many tokens to fetch concurrently. xrpl.js multiplexes requests
 *  over the single ingestionClient WebSocket via request IDs, so this is
 *  pure JS-level concurrency, not extra connections. Public XRPL nodes
 *  cap somewhere around 10-20 reqs/sec; per-token fetch makes 2-4 calls
 *  (gateway_balances + paginated account_lines), so 3 in-flight tokens =
 *  ~6-12 in-flight XRPL requests, well under the cap. */
const TOKEN_CONCURRENCY = 3;

/** Delay between batches (not per-token). Lets the WS catch its breath
 *  and gives any retry windows time to settle. */
const BATCH_DELAY_MS = 500;

interface HolderSnapshotRow extends Record<string, unknown> {
  snapshot_time: string;
  currency: string;
  issuer: string;
  holder_address: string;
  balance: number;
  total_supply: number;
  rank: number;
}

/**
 * Run a single holder-snapshot poll: discover active tokens via the CH
 * `mv_token_volume_hourly` view, fetch top-10 holders for each from
 * the XRPL ingestion client, and insert one row per holder into CH.
 *
 * Returns the count of tokens successfully snapshotted. Throws on
 * fatal errors; per-token failures are logged and skipped.
 */
export async function runOnce(): Promise<number> {
  const startedAt = Date.now();
  logger.info("[holder-snapshots] Starting poll");

  // Active tokens: any (base_currency, base_issuer) with volume in 7d.
  // dex_trades convention puts the token on `base_*` when paired with
  // XRP (and on either side for token-token pairs), so DISTINCT on
  // base_currency+base_issuer covers all actively-traded tokens.
  const activeTokens = await chQuery<{ currency: string; issuer: string }>(
    `SELECT DISTINCT base_currency AS currency, base_issuer AS issuer
     FROM mv_token_volume_hourly
     WHERE hour > now() - INTERVAL 7 DAY
       AND base_issuer != ''`,
  );

  if (activeTokens.length === 0) {
    logger.info("[holder-snapshots] No active tokens found");
    return 0;
  }

  // Single timestamp for the whole poll — every row written in this
  // run shares a snapshot_time, so per-token diffing in whale-activity
  // sees them as one cohesive snapshot. Millisecond precision.
  const now = new Date();
  const snapshotTime = now.toISOString().slice(0, 23).replace("T", " ");

  let snapshotted = 0;
  let lastHeartbeat = Date.now();

  // Process tokens in concurrent batches. The previous implementation
  // ran one token at a time with a 3-second sleep between each; on
  // Railway's network to XRPL that worked out to ~7 sec/token = ~3.5
  // hours for ~1,800 tokens, which doesn't fit comfortably under the
  // 4-hour cron cadence. With concurrency=3 and a half-second batch
  // delay, total wall time drops to ~30-45 minutes.
  for (let i = 0; i < activeTokens.length; i += TOKEN_CONCURRENCY) {
    const batch = activeTokens.slice(i, i + TOKEN_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (token) => {
        const result = await fetchTopHolders(
          token.currency,
          token.issuer,
          getIngestionClient(),
        );
        if (result.holders.length === 0) return false;

        const rows: HolderSnapshotRow[] = result.holders.map((h, idx) => ({
          snapshot_time: snapshotTime,
          currency: token.currency,
          issuer: token.issuer,
          holder_address: h.address,
          balance: h.balance,
          total_supply: result.totalSupply,
          rank: idx + 1,
        }));
        await chInsert("token_holder_snapshots", rows);
        return true;
      }),
    );

    for (let r = 0; r < results.length; r++) {
      const result = results[r];
      if (result.status === "fulfilled" && result.value) {
        snapshotted++;
      } else if (result.status === "rejected") {
        const token = batch[r];
        logger.warn(
          { err: result.reason instanceof Error ? result.reason.message : result.reason },
          `[holder-snapshots] Failed for ${token.currency}:${token.issuer}`,
        );
      }
    }

    // Heartbeat log every ~60 seconds so long runs are observable in
    // Railway's deploy logs without spamming a line per batch.
    if (Date.now() - lastHeartbeat > 60_000) {
      logger.info(
        { processed: i + batch.length, total: activeTokens.length, snapshotted },
        "[holder-snapshots] Progress",
      );
      lastHeartbeat = Date.now();
    }

    if (i + TOKEN_CONCURRENCY < activeTokens.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  logger.info(
    { snapshotted, total: activeTokens.length, elapsedSeconds: elapsed },
    `[holder-snapshots] Snapshotted ${snapshotted}/${activeTokens.length} tokens in ${elapsed}s`,
  );

  return snapshotted;
}

/* ── Cross-process mutex via job_state ─────────────────────────────────
 * Mirrors the smart-money-scorer pattern. Prevents two cron triggers
 * from snapshotting concurrently if a run is already in flight. The
 * `job_state` row uses PG (transactional integrity), not CH.
 */

async function acquireLock(): Promise<boolean> {
  const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();

  await db.execute(sql`
    INSERT INTO job_state (job_name, status, updated_at)
    VALUES (${JOB_NAME}, 'idle', NOW())
    ON CONFLICT (job_name) DO NOTHING
  `);

  const result = await db.execute<{ job_name: string }>(sql`
    UPDATE job_state
    SET status = 'running', locked_until = ${lockedUntil}, updated_at = NOW()
    WHERE job_name = ${JOB_NAME}
      AND (status != 'running' OR locked_until < NOW())
    RETURNING job_name
  `);

  return result.length > 0;
}

async function releaseLock(success: boolean, error?: string): Promise<void> {
  await db.execute(sql`
    UPDATE job_state
    SET
      status = ${success ? "idle" : "failed"},
      locked_until = NULL,
      last_run_at = NOW(),
      run_count = run_count + 1,
      last_error = ${error ?? null},
      updated_at = NOW()
    WHERE job_name = ${JOB_NAME}
  `);
}

/**
 * Cron entry point: acquire the cross-process lock, run a single
 * poll, release the lock. Returns the snapshot count, or null if a
 * concurrent run already held the lock.
 */
export async function runWithLock(): Promise<number | null> {
  const acquired = await acquireLock();
  if (!acquired) {
    logger.warn("[holder-snapshots] Lock not acquired — another run in flight, skipping");
    return null;
  }

  try {
    const count = await runOnce();
    await releaseLock(true);
    return count;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[holder-snapshots] Run failed");
    await releaseLock(false, message);
    throw err;
  }
}

/**
 * Legacy export — `init-server.ts` calls `initHolderSnapshots()` to
 * spin up the in-process polling loop. With the migration to a
 * Railway cron entry point, that loop is gone; this is now a no-op
 * that logs and returns. Left in place so existing callers don't
 * break, and so the function name is searchable when removing the
 * caller in init-server.ts.
 */
export function initHolderSnapshots(): void {
  logger.info(
    "[holder-snapshots] In-process polling disabled — runs via Railway cron (scripts/run-holder-snapshot.ts) every 4h",
  );
}
