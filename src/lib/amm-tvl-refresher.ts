/**
 * AmmPoolTvlRefresher — periodic job that refreshes the cached tvl_xrp
 * on every known AMM pool.
 *
 * Reads: amm_pools table (discovery registry)
 * Writes: amm_pools.tvl_xrp, amm_pools.tvl_updated_at
 * XRPL calls: amm_info, one per pool, concurrency-capped
 *
 * Design notes:
 * - Caches TVL so `getTopAMMPools` doesn't fan out O(N) amm_info calls
 *   per page load. Without this, 4000+ pools × every cache-miss read
 *   would overwhelm rippled.
 * - Refresh interval is longer than the 15-min LRU on the read path
 *   so reads usually see DB-cached TVL, not live.
 * - Follows the same singleton + init pattern as HolderSnapshotManager.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getIngestionClient } from "./ingestion";
import type { AMMInfoResponse } from "@/types/xrpl-responses";
import logger from "@/lib/logger";

/** Poll interval: 10 min. Matches typical holder-snapshot cadence; balances
 *  freshness vs. rippled load. */
const POLL_INTERVAL = 10 * 60 * 1000;

/** Delay before the first poll on boot. Keeps this manager out of the way
 *  while intel-ingestion and portfolio-snapshots establish their working
 *  state — both share the same ingestionClient WS. */
const INITIAL_POLL_DELAY = 45 * 1000;

/** Max parallel amm_info requests to avoid saturating the WS client. */
const CONCURRENCY = 10;

/** Skip pools whose TVL was updated this recently — lets a fresh backfill
 *  or an ingestion insert avoid immediate re-fetch. */
const RECENT_UPDATE_GRACE = 5 * 60 * 1000;

class AmmPoolTvlRefresher {
  private running = false;
  private polling = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info("[amm-tvl-refresher] Starting — first poll deferred to avoid startup WS contention");

    // Defer the initial poll so other ingestion managers (intel-ingestion,
    // portfolio-snapshots) can establish their working state without being
    // starved by ~10 parallel amm_info calls on the shared ingestionClient.
    // Without this, cold-start batches timed out for ~20s while this manager
    // drained its queue.
    setTimeout(() => {
      if (!this.running) return;
      this.poll().catch((err) =>
        logger.error({ err }, "[amm-tvl-refresher] Initial poll failed"),
      );
    }, INITIAL_POLL_DELAY);

    this.pollTimer = setInterval(
      () => this.poll().catch((err) => logger.error({ err }, "[amm-tvl-refresher] Unexpected error")),
      POLL_INTERVAL,
    );

    logger.info("[amm-tvl-refresher] Running — polling every 10 minutes");
  }

  async stop(): Promise<void> {
    logger.info("[amm-tvl-refresher] Stopping");
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      // Only refresh pools whose TVL is stale or missing. Running backfill
      // recently won't blow up the rippled connection because of this guard.
      const pools = await db.execute<{
        account: string;
        asset1_currency: string;
        asset2_currency: string;
      }>(sql`
        SELECT account, asset1_currency, asset2_currency
        FROM amm_pools
        WHERE tvl_updated_at IS NULL
           OR tvl_updated_at < NOW() - INTERVAL '${sql.raw(String(Math.floor(RECENT_UPDATE_GRACE / 1000)))} seconds'
        ORDER BY tvl_updated_at ASC NULLS FIRST
      `);

      if (pools.length === 0) {
        logger.info("[amm-tvl-refresher] No pools needed refreshing");
        return;
      }

      logger.info(`[amm-tvl-refresher] Refreshing ${pools.length} pools`);
      const startTime = Date.now();
      let updated = 0;
      let cleared = 0;

      const client = getIngestionClient();

      // Concurrency cap via a simple cursor + worker pool
      let cursor = 0;
      const worker = async () => {
        while (this.running) {
          const i = cursor++;
          if (i >= pools.length) return;
          const pool = pools[i];
          try {
            const res = (await client.send({
              command: "amm_info",
              amm_account: pool.account,
              ledger_index: "validated",
            })) as AMMInfoResponse | { error?: string };

            // Typed guard: AMM not found / deleted
            if (!("amm" in res) || !res.amm) {
              // Pool likely deleted from ledger — clear TVL so it stops ranking
              await db.execute(sql`
                UPDATE amm_pools
                SET tvl_xrp = NULL, tvl_updated_at = NOW()
                WHERE account = ${pool.account}
              `);
              cleared++;
              continue;
            }

            const amm = res.amm;
            const xrpDrops =
              typeof amm.amount === "string"
                ? Number(amm.amount)
                : typeof amm.amount2 === "string"
                  ? Number(amm.amount2)
                  : 0;

            // Token/token pool — no XRP anchor, skip TVL for now. (Future:
            // convert via a token price oracle.)
            if (xrpDrops <= 0) {
              await db.execute(sql`
                UPDATE amm_pools
                SET tvl_updated_at = NOW()
                WHERE account = ${pool.account}
              `);
              continue;
            }

            const tvlXrp = (xrpDrops / 1_000_000) * 2;
            await db.execute(sql`
              UPDATE amm_pools
              SET tvl_xrp = ${tvlXrp.toFixed(6)}, tvl_updated_at = NOW()
              WHERE account = ${pool.account}
            `);
            updated++;
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : err, account: pool.account },
              "[amm-tvl-refresher] amm_info failed for pool",
            );
          }
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

      logger.info(
        `[amm-tvl-refresher] Done — updated ${updated}, cleared ${cleared} in ${Date.now() - startTime}ms`,
      );
    } finally {
      this.polling = false;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Singleton + conditional startup                                    */
/* ------------------------------------------------------------------ */

const globalForAmmTvl = globalThis as unknown as {
  ammPoolTvlRefresher?: AmmPoolTvlRefresher;
};
const ammPoolTvlRefresher =
  globalForAmmTvl.ammPoolTvlRefresher ??
  (globalForAmmTvl.ammPoolTvlRefresher = new AmmPoolTvlRefresher());

/**
 * Conditional startup. Safe to call multiple times — only starts once.
 * Skips when ingestion is disabled (e.g. local dev without ENABLE_INGESTION).
 */
export function initAmmPoolTvlRefresher(): void {
  if (process.env.ENABLE_INGESTION !== "true") {
    logger.info("[amm-tvl-refresher] Disabled (ENABLE_INGESTION !== true)");
    return;
  }
  if (!process.env.DATABASE_URL) {
    logger.info("[amm-tvl-refresher] Disabled (no DATABASE_URL)");
    return;
  }

  ammPoolTvlRefresher.start().catch((err) => {
    logger.error({ err }, "[amm-tvl-refresher] Failed to start");
  });
}
