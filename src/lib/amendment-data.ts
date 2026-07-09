/**
 * AmendmentManager — polls the XRPL `feature` command to track
 * amendment voting status over time.
 *
 * Stores snapshots in Postgres so the UI can render vote history charts.
 * Falls back to the Amendments ledger entry if `feature` is unavailable.
 *
 * Runs independently of the ingestion pipeline.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { amendments, amendmentVotes } from "@/db/schema";
import { xrplClient } from "./xrpl-client";
import type { FeatureResponse } from "@/types/xrpl-responses";
import type { AmendmentsLedgerEntry } from "@/types/amendments";
import logger from "@/lib/logger";

/** Poll interval: 15 minutes */
const POLL_INTERVAL = 15 * 60 * 1000;

/** Compaction interval: 6 hours */
const COMPACT_INTERVAL = 6 * 60 * 60 * 1000;

/** Well-known Amendments ledger entry index */
const AMENDMENTS_OBJECT_INDEX =
  "7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4";

/* ------------------------------------------------------------------ */
/*  Snapshot type (internal)                                           */
/* ------------------------------------------------------------------ */

interface AmendmentSnapshot {
  hash: string;
  name: string;
  enabled: boolean;
  yesCount: number;
  threshold: number;
  totalValidators: number;
  hasMajority: boolean;
}

/* ------------------------------------------------------------------ */
/*  Manager class                                                      */
/* ------------------------------------------------------------------ */

class AmendmentManager {
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private compactTimer: ReturnType<typeof setInterval> | null = null;
  private featureAvailable: boolean | null = null;
  /** Counter to periodically re-check feature availability */
  private pollsSinceFeatureCheck = 0;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info("[amendments] Starting amendment tracker");

    // Poll immediately on start
    await this.poll().catch((err) =>
      logger.error("[amendments] Initial poll failed:", err),
    );

    // Schedule recurring polls
    this.pollTimer = setInterval(
      () => this.poll().catch((err) => logger.error(err)),
      POLL_INTERVAL,
    );

    // Schedule compaction
    this.compactTimer = setInterval(
      () => this.compact().catch((err) => logger.error(err)),
      COMPACT_INTERVAL,
    );

    logger.info("[amendments] Tracker started — polling every 15 minutes");
  }

  async stop(): Promise<void> {
    logger.info("[amendments] Stopping amendment tracker");
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.compactTimer) {
      clearInterval(this.compactTimer);
      this.compactTimer = null;
    }
  }

  /* ---------- Core polling ---------- */

  /** Public entry for systemd-timer scripts that need a single poll
   *  cycle without spinning up the setInterval loop. */
  async pollOnce(): Promise<void> {
    return this.poll();
  }

  /** Public entry for systemd-timer scripts that need to run the
   *  compaction queries once without the loop. */
  async compactOnce(): Promise<void> {
    // The instance check on `this.running` inside compact() exists to
    // guard the in-process setInterval; for one-shot invocations we
    // bypass it by toggling running=true around the call.
    const wasRunning = this.running;
    this.running = true;
    try {
      await this.compact();
    } finally {
      this.running = wasRunning;
    }
  }

  private async poll(): Promise<void> {
    const now = new Date();
    let snapshots: AmendmentSnapshot[] | null = null;

    // Try `feature` command first (may be admin-only).
    // Periodically re-check even if previously unavailable (server may have changed).
    if (this.featureAvailable === false) {
      this.pollsSinceFeatureCheck++;
      // Re-check every ~20 polls (~5 hours at 15min intervals)
      if (this.pollsSinceFeatureCheck >= 20) {
        this.featureAvailable = null;
        this.pollsSinceFeatureCheck = 0;
      }
    }
    if (this.featureAvailable !== false) {
      snapshots = await this.fetchFromFeature();
      if (snapshots) {
        this.featureAvailable = true;
      } else if (this.featureAvailable === null) {
        this.featureAvailable = false;
        logger.info(
          "[amendments] `feature` command unavailable, using ledger entry fallback",
        );
      }
    }

    // Fallback to Amendments ledger entry
    if (!snapshots) {
      snapshots = await this.fetchFromLedgerEntry();
    }

    if (!snapshots || snapshots.length === 0) {
      logger.warn("[amendments] No amendment data retrieved");
      return;
    }

    // Persist to DB
    await this.saveSnapshots(snapshots, now);
    logger.info(
      `[amendments] Polled ${snapshots.length} amendments (${snapshots.filter((s) => !s.enabled).length} pending)`,
    );
  }

  /* ---------- Data sources ---------- */

  private async fetchFromFeature(): Promise<AmendmentSnapshot[] | null> {
    try {
      const result = (await xrplClient.send({
        command: "feature",
      })) as FeatureResponse | null;

      if (!result || typeof result !== "object") return null;

      const snapshots: AmendmentSnapshot[] = [];

      for (const [hash, info] of Object.entries(result)) {
        // Skip if no name (shouldn't happen but be defensive)
        if (!info.name) continue;

        const hasVoteCounts =
          info.count !== undefined && info.validations !== undefined;

        snapshots.push({
          hash,
          name: info.name,
          enabled: info.enabled,
          yesCount: hasVoteCounts ? (info.count ?? 0) : 0,
          threshold: hasVoteCounts ? (info.threshold ?? 0) : 0,
          totalValidators: hasVoteCounts ? (info.validations ?? 0) : 0,
          hasMajority: hasVoteCounts
            ? (info.count ?? 0) >= (info.threshold ?? 1)
            : false,
        });
      }

      // If there are pending amendments but none have vote counts, the response
      // is not useful for vote tracking — fall back to ledger entry.
      // If all amendments are enabled (no pending), the data is valid as-is.
      const hasPending = snapshots.some((s) => !s.enabled);
      if (
        hasPending &&
        snapshots.every((s) => s.totalValidators === 0)
      ) {
        return null;
      }

      return snapshots.length > 0 ? snapshots : null;
    } catch {
      return null;
    }
  }

  private async fetchFromLedgerEntry(): Promise<AmendmentSnapshot[] | null> {
    try {
      const result = (await xrplClient.getLedgerEntry(
        AMENDMENTS_OBJECT_INDEX,
      )) as { node?: AmendmentsLedgerEntry } | null;

      const node = result?.node;
      if (!node) return null;

      const enabledSet = new Set(node.Amendments ?? []);
      const majorities = node.Majorities ?? [];

      // Combine enabled + majority amendments into snapshots
      // Without `feature`, we don't have names or exact vote counts
      const snapshots: AmendmentSnapshot[] = [];

      for (const hash of enabledSet) {
        snapshots.push({
          hash,
          name: hash, // No name available from ledger entry
          enabled: true,
          yesCount: 0,
          threshold: 0,
          totalValidators: 0,
          hasMajority: true,
        });
      }

      for (const majority of majorities) {
        const hash = majority.Majority.Amendment;
        if (!enabledSet.has(hash)) {
          snapshots.push({
            hash,
            name: hash,
            enabled: false,
            yesCount: 0,
            threshold: 0,
            totalValidators: 0,
            hasMajority: true,
          });
        }
      }

      return snapshots.length > 0 ? snapshots : null;
    } catch (err) {
      logger.error({ err }, "[amendments] Ledger entry fetch failed");
      return null;
    }
  }

  /* ---------- Persistence ---------- */

  private async saveSnapshots(
    snapshots: AmendmentSnapshot[],
    recordedAt: Date,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      for (const snap of snapshots) {
        // Upsert amendment metadata
        await tx
          .insert(amendments)
          .values({
            hash: snap.hash,
            name: snap.name,
            enabled: snap.enabled,
            enabledAt: snap.enabled ? recordedAt : null,
          })
          .onConflictDoUpdate({
            target: amendments.hash,
            set: {
              name:
                snap.name !== snap.hash
                  ? snap.name
                  : sql`CASE WHEN ${amendments.name} = ${amendments.hash} THEN ${snap.name} ELSE ${amendments.name} END`,
              enabled: snap.enabled,
              enabledAt: snap.enabled
                ? sql`COALESCE(${amendments.enabledAt}, ${recordedAt.toISOString()})`
                : sql`${amendments.enabledAt}`,
              updatedAt: recordedAt,
            },
          });

        // Only record vote snapshots for non-enabled amendments
        if (!snap.enabled && snap.totalValidators > 0) {
          await tx
            .insert(amendmentVotes)
            .values({
              amendmentHash: snap.hash,
              recordedAt,
              yesCount: snap.yesCount,
              threshold: snap.threshold,
              totalValidators: snap.totalValidators,
              hasMajority: snap.hasMajority,
            })
            .onConflictDoNothing();
        }
      }
    });
  }

  /* ---------- Compaction ---------- */

  private async compact(): Promise<void> {
    if (!this.running) return;

    // Snapshots 7–30 days old: keep one per 4-hour window
    await db.execute(sql`
      DELETE FROM amendment_votes
      WHERE recorded_at < NOW() - INTERVAL '7 days'
        AND recorded_at >= NOW() - INTERVAL '30 days'
        AND (amendment_hash, recorded_at) NOT IN (
          SELECT amendment_hash, MIN(recorded_at)
          FROM amendment_votes
          WHERE recorded_at < NOW() - INTERVAL '7 days'
            AND recorded_at >= NOW() - INTERVAL '30 days'
          GROUP BY amendment_hash, date_trunc('hour', recorded_at) - (EXTRACT(HOUR FROM recorded_at)::int % 4) * INTERVAL '1 hour'
        )
    `);

    // Snapshots > 30 days: keep one per day
    await db.execute(sql`
      DELETE FROM amendment_votes
      WHERE recorded_at < NOW() - INTERVAL '30 days'
        AND (amendment_hash, recorded_at) NOT IN (
          SELECT amendment_hash, MIN(recorded_at)
          FROM amendment_votes
          WHERE recorded_at < NOW() - INTERVAL '30 days'
          GROUP BY amendment_hash, date_trunc('day', recorded_at)
        )
    `);

    logger.info("[amendments] Compaction complete");
  }
}

/* ------------------------------------------------------------------ */
/*  Singleton + conditional startup                                    */
/* ------------------------------------------------------------------ */

const globalForAmendments = globalThis as unknown as { amendmentManager?: AmendmentManager };
const amendmentManager = globalForAmendments.amendmentManager ?? (globalForAmendments.amendmentManager = new AmendmentManager());

/**
 * Legacy in-process polling entry point. Pre-cutover this called
 * setInterval and ran the poll loop inside the Next.js process.
 * That pattern broke silently on Railway when container recycles
 * killed the timer between runs (same bug that broke smart-money
 * scoring + holder/portfolio snapshots). Polling now runs as a
 * Hetzner systemd timer (`sonde-amendment-tracker.timer` →
 * `scripts/run-amendment-tracker.ts`).
 *
 * Kept exported as a no-op so existing callers (init-server.ts) and
 * the build don't break, but it intentionally does nothing now.
 */
export function initAmendmentPolling(): void {
  logger.info(
    "[amendments] In-process polling disabled — handled by sonde-amendment-tracker.timer on Hetzner",
  );
}

/** One-shot poll — for the systemd-timer script. */
export async function runPollOnce(): Promise<void> {
  return amendmentManager.pollOnce();
}

/** One-shot compaction — for the systemd-timer script. */
export async function compactOnce(): Promise<void> {
  return amendmentManager.compactOnce();
}
