/**
 * Unified backfill — uses the same `ingestLedger` per-ledger pipeline as the
 * live runner so EVERY ClickHouse table (transactions, dex_trades,
 * trustline_events, ledger_metadata, amm_state_changes, nft_trades,
 * payment_corridors) gets populated for historical ledgers, not just the
 * subset the old script wrote.
 *
 * Architecture:
 *   - Walks BACKWARD from `intel_latest_ledger - 1` toward a configurable
 *     floor (default = 4,000,000 ledgers ≈ ~6 months at 4s/ledger).
 *   - N concurrent workers (default 5) each pull indices from a shared
 *     in-memory queue and call `ingestLedger(ctx, idx)` independently.
 *     This gives parallelism without the old fetch-batch-then-write-batch
 *     coupling — each worker owns its ledger end-to-end.
 *   - **Multi-client WS pool.** One `XrplClient` per `BACKFILL_WS_ENDPOINTS`
 *     entry. Workers route by `workerId % pool.length`, giving N parallel
 *     request streams instead of multiplexing through one socket. This is
 *     the throughput-scaling lever — adding endpoints adds streams. The
 *     ceiling at single-socket was endpoint-side request rate (~10
 *     ledgers/sec); each added endpoint gives roughly another 10/sec until
 *     other resources (CPU, CH parts merge) become the new floor.
 *   - Resumable via `ingestion_state.backfill_next_ledger`. Pointer is
 *     persisted after each chunk drains.
 *   - On `lgrNotFound`, logs to `backfill_gaps` and skips. No retries.
 *   - SIGINT/SIGTERM → graceful drain (30s cap), persist checkpoint, exit.
 *
 * Pointer writes inside `ingestLedger` use `GREATEST` / `LEAST` guards on
 * `intel_latest_ledger` and `earliest_ledger`, so walking backward is safe:
 * the live pointer never gets clobbered by an older ledger, and the earliest
 * pointer keeps tracking the actual oldest ingested ledger.
 *
 * Marketplace registry is loaded ONCE at startup. Tracked accounts are
 * INTENTIONALLY EMPTY — backfill must not compute cost basis events for
 * historical data because that would corrupt the current per-account
 * running totals. (Cost basis only makes sense forward-walking from the
 * day a wallet signs in.) Token icon resolution and NFT URI capture are
 * also off — those are best-effort live-only enrichments.
 *
 * Phasing strategy:
 *   - Initial run: 4,000,000 ledgers (~6 months) to keep wall time tractable
 *     before going wider.
 *   - Subsequent runs: raise BACKFILL_LEDGERS_BACK (12mo → 3yr → full).
 *   - Each run resumes from the pointer, so a wider run after a narrower
 *     run continues from where the last run stopped.
 *
 * Deployment:
 *   - Hetzner systemd unit: `sonde-backfill.service` (already exists).
 *   - Manual run:
 *       NODE_OPTIONS="--conditions react-server" pnpm tsx scripts/backfill-history.ts
 *
 * Required env:
 *   DATABASE_URL, CLICKHOUSE_URL
 *
 * Optional env:
 *   BACKFILL_CONCURRENCY      Worker count                          (default 5)
 *   BACKFILL_CHUNK_SIZE       Ledgers refilled into queue at a time (default 50)
 *   BACKFILL_TARGET_LEDGER    Absolute floor (deterministic). When set,
 *                             walk-back stops at this exact ledger and
 *                             LEDGERS_BACK is ignored. Use this once you
 *                             know the retention depth you want — the
 *                             original "walk LEDGERS_BACK from current
 *                             pointer" model walked unbounded distances
 *                             across crash-restarts (incident 2026-05-07).
 *   BACKFILL_LEDGERS_BACK     Walk distance from intel_latest at first run
 *                                                                  (default 4,000,000)
 *                             Fallback when BACKFILL_TARGET_LEDGER unset.
 *                             Anchored to the FIRST RUN's intel_latest
 *                             (persisted in ingestion_state.backfill_first_run_latest)
 *                             so crash-restarts don't keep extending the
 *                             walk. Reset by deleting that PG row.
 *   BACKFILL_WS_ENDPOINTS     Comma-separated WS endpoints for backfill (default wss://honeycluster.io)
 *                             Each entry becomes its own XrplClient = one
 *                             WS connection. More entries = more parallel
 *                             streams; throughput scales roughly linearly
 *                             until network/CPU/CH-merge caps it. Use
 *                             honeycluster (Clio + full history) for any
 *                             tranche reaching past xrplcluster's
 *                             ~12-month pruning boundary. xrplcluster.com
 *                             returns lgrNotFound for older ranges and
 *                             would force its workers to log gaps.
 *   BACKFILL_LOG_INTERVAL     Log every N ledgers                   (default 100)
 *   BACKFILL_REPLAY_GAPS=1    Replay mode — re-ingest unresolved
 *                             entries from `backfill_gaps` instead of
 *                             walking back. Filters out partial-write
 *                             gaps (those with existing CH writes) to
 *                             avoid double-counting in MV SummingMergeTree
 *                             targets; those need a separate partition
 *                             recompute pass. Marks resolved on success.
 *                             Run after the main backfill finishes, OR
 *                             alongside it (separate process — make sure
 *                             the resumable walk-back checkpoint isn't
 *                             clobbered: replay mode doesn't write to it).
 */

import { config } from "dotenv";
// Local dev uses .env.local; Hetzner uses .env (loaded by systemd unit).
// Try .env.local first; existing env vars (set by systemd or shell) win,
// so a second fallback to .env is safe — it only fills in what's missing.
config({ path: ".env.local" });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db, client as pgClient } from "@/db";
import {
  ingestionState,
  marketplaceRegistry,
} from "@/db/schema";
import { XrplClient } from "@/lib/xrpl-client";
import { ingestLedger, type IngestContext } from "@/lib/ledger-ingester";
import * as ch from "@/lib/clickhouse-client";
import logger from "@/lib/logger";

const log = logger.child({ module: "backfill-history" });

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const CONCURRENCY = Math.max(1, parseInt(process.env.BACKFILL_CONCURRENCY ?? "5", 10));
const CHUNK_SIZE = Math.max(1, parseInt(process.env.BACKFILL_CHUNK_SIZE ?? "50", 10));
const LEDGERS_BACK = Math.max(1, parseInt(process.env.BACKFILL_LEDGERS_BACK ?? "4000000", 10));
/** Optional absolute floor — when set, the walk-back stops at this exact
 *  ledger index, and `LEDGERS_BACK` / pointer state are ignored. This is
 *  the deterministic lever: set it to the lowest ledger you want retained
 *  and the script will never walk below it, even across crash-restarts.
 *  Use this once you know the depth you want; leave unset for greenfield
 *  walks where the legacy "first-run-derived" floor is fine. */
const TARGET_LEDGER = process.env.BACKFILL_TARGET_LEDGER
  ? Math.max(1, parseInt(process.env.BACKFILL_TARGET_LEDGER, 10))
  : null;
/** When set, the script switches from the normal walk-back walk into "replay
 * mode": load unresolved entries from `backfill_gaps`, ingest each ledger,
 * and mark resolved on success. Partial-write gaps (those with existing
 * `ledger_metadata` entries) are skipped to avoid double-counting in the
 * SummingMergeTree MVs — they need a heavier partition-recompute pass which
 * is not done here. */
const REPLAY_GAPS_MODE = process.env.BACKFILL_REPLAY_GAPS === "1";
// honeycluster is Clio + full history — safe for any tranche depth.
// Falls back to s2.ripple.com (Ripple's history server) if honeycluster
// is unreachable. Prefer honeycluster as primary because it's a Clio
// cluster (better expanded-ledger support, lighter on rippled).
const WS_ENDPOINTS = (process.env.BACKFILL_WS_ENDPOINTS
  ?? process.env.BACKFILL_WS_ENDPOINT  // legacy single-value var name
  ?? "wss://honeycluster.io,wss://s2.ripple.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const LOG_INTERVAL = Math.max(1, parseInt(process.env.BACKFILL_LOG_INTERVAL ?? "100", 10));

/** Drain timeout on shutdown — bounded so a wedged worker can't block exit. */
const SHUTDOWN_DRAIN_MS = 30_000;

/* ------------------------------------------------------------------ */
/*  Validate env                                                       */
/* ------------------------------------------------------------------ */

if (!process.env.DATABASE_URL) {
  console.error("[backfill-history] DATABASE_URL required");
  process.exit(1);
}
if (!process.env.CLICKHOUSE_URL) {
  console.error("[backfill-history] CLICKHOUSE_URL required");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  Pointer helpers (drizzle-typed for ingestion_state)                */
/* ------------------------------------------------------------------ */

async function getIntPointer(key: string): Promise<number | null> {
  const rows = await db
    .select({ value: ingestionState.value })
    .from(ingestionState)
    .where(sql`${ingestionState.key} = ${key}`)
    .limit(1);
  if (rows.length === 0) return null;
  const n = Number(rows[0].value);
  return Number.isFinite(n) ? n : null;
}

async function setIntPointer(key: string, value: number): Promise<void> {
  await db.insert(ingestionState)
    .values({ key, value: String(value) })
    .onConflictDoUpdate({
      target: ingestionState.key,
      set: { value: String(value), updatedAt: new Date() },
    });
}

/* ------------------------------------------------------------------ */
/*  Gap detection + logging                                            */
/* ------------------------------------------------------------------ */

/** Detect rippled "ledger not found" errors. Shape varies (object with
 * .error / .error_code, or Error.message containing the string). */
function isLedgerNotFound(err: unknown): boolean {
  if (!err) return false;
  const errorObj = err as { error?: string; error_code?: number; message?: string };
  if (errorObj.error === "lgrNotFound") return true;
  // XRPL error code 21 is the invalidLgrRange / lgrNotFound family.
  if (errorObj.error_code === 21) return true;
  if (typeof errorObj.message === "string" && /lgrNotFound|ledger.*not.*found/i.test(errorObj.message)) return true;
  return false;
}

/** Detect transient errors that warrant a requeue rather than a permanent
 * skip. `slowDown` (error_code 10) is the big one — Clio/rippled returns
 * this when our request rate exceeds its per-client throttle. Other
 * transient signals: WS disconnects mid-request, generic "tooBusy"
 * (error_code 20), connection-level throws. */
function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const errorObj = err as { error?: string; error_code?: number; message?: string };
  if (errorObj.error === "slowDown") return true;
  if (errorObj.error_code === 10) return true; // slowDown
  if (errorObj.error_code === 20) return true; // tooBusy
  if (errorObj.error === "noNetwork") return true;
  if (typeof errorObj.message === "string") {
    const msg = errorObj.message.toLowerCase();
    // Common transient signals from xrpl-client / WS layer:
    //   "Request timed out"   — request-level WS timeout (most common under load)
    //   "WebSocket closed"    — socket dropped mid-request
    //   "Connection lost"     — TCP-level
    //   "ETIMEDOUT" / "ECONN…" — Node net error codes
    if (
      msg.includes("websocket")
      || msg.includes("ws closed")
      || msg.includes("connection")
      || msg.includes("timeout")
      || msg.includes("timed out")
      || msg.includes("etimedout")
      || msg.includes("econnreset")
      || msg.includes("econnrefused")
    ) {
      return true;
    }
  }
  return false;
}

/** Idempotent gap log — same ledger may hit lgrNotFound multiple times if
 * the worker pool retries, so ON CONFLICT updates reason+attempted_at and
 * leaves resolved_at NULL (i.e., the gap is still considered open). Failure
 * to log is non-fatal — we just warn. */
async function logBackfillGap(ledgerIndex: number, reason: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO backfill_gaps (ledger_index, reason, attempted_at)
      VALUES (${ledgerIndex}, ${reason}, now())
      ON CONFLICT (ledger_index)
      DO UPDATE SET reason = EXCLUDED.reason, attempted_at = EXCLUDED.attempted_at
    `);
  } catch (err) {
    log.warn({ err, ledgerIndex }, "failed to log backfill gap");
  }
}

/** Mark a previously-logged gap as resolved. Called from replay mode after
 * a successful re-ingestion. Idempotent — UPDATE WHERE resolved_at IS NULL
 * means re-running this is a no-op. Non-fatal on error. */
async function markGapResolved(ledgerIndex: number): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE backfill_gaps SET resolved_at = now()
      WHERE ledger_index = ${ledgerIndex} AND resolved_at IS NULL
    `);
  } catch (err) {
    log.warn({ err, ledgerIndex }, "failed to mark gap resolved");
  }
}

/** Load unresolved backfill gaps and partition them into:
 *   - safeToReplay: ledgers with NO existing CH writes (pre-write failures).
 *     These can be re-ingested via the standard pipeline because all source
 *     tables are ReplacingMergeTree — duplicates dedup at merge time.
 *   - partialWrite: ledgers that have at least one CH write (failure occurred
 *     mid-ingestion). Re-ingesting these would be safe for source tables
 *     (still ReplacingMergeTree), but the SummingMergeTree MV-target tables
 *     (mv_hourly_tx_volume, mv_payment_corridor_*, mv_fee_burn_*, etc.) would
 *     double-count the partial slice that already made it through. These need
 *     a heavier partition-recompute pass — log them out for separate handling.
 */
async function loadUnresolvedGaps(): Promise<{
  safeToReplay: number[];
  partialWrite: number[];
}> {
  // Fetch all unresolved gap ledger indices from PG.
  const rows = await db.execute<{ ledger_index: number }>(sql`
    SELECT ledger_index FROM backfill_gaps
    WHERE resolved_at IS NULL
    ORDER BY ledger_index DESC
  `);
  const ids = rows.map((r) => Number(r.ledger_index));
  if (ids.length === 0) return { safeToReplay: [], partialWrite: [] };

  // Cross-check against CH ledger_metadata. ledger_metadata is written near
  // the END of the ingestion pipeline, so its presence indicates the ledger
  // got most of its writes through. Absence indicates a pre-write failure.
  // We use ledger_metadata as the cheap proxy; the reality is more nuanced
  // (some ledgers have transactions but no ledger_metadata = mid-pipeline
  // failure) but for now any non-zero CH presence triggers the partial-write
  // bucket so we don't risk double-counting.
  const idsCsv = ids.join(",");
  const lmHits = await ch.query<{ ledger_index: number }>(
    `SELECT ledger_index FROM sonde.ledger_metadata WHERE ledger_index IN (${idsCsv})`,
  );
  const txHits = await ch.query<{ ledger_index: number }>(
    `SELECT DISTINCT ledger_index FROM sonde.transactions WHERE ledger_index IN (${idsCsv})`,
  );
  const partialSet = new Set<number>([
    ...lmHits.map((r) => Number(r.ledger_index)),
    ...txHits.map((r) => Number(r.ledger_index)),
  ]);

  const safeToReplay: number[] = [];
  const partialWrite: number[] = [];
  for (const id of ids) {
    if (partialSet.has(id)) partialWrite.push(id);
    else safeToReplay.push(id);
  }
  return { safeToReplay, partialWrite };
}

/* ------------------------------------------------------------------ */
/*  Determine starting ledger                                          */
/* ------------------------------------------------------------------ */

async function determineStart(): Promise<number> {
  // Preferred: resume from existing backfill checkpoint.
  const existing = await getIntPointer("backfill_next_ledger");
  if (existing != null && existing > 0) {
    log.info({ checkpoint: existing }, "Resuming from backfill_next_ledger checkpoint");
    return existing;
  }

  // First run: start one ledger below the live intel pointer so we don't
  // contend with live ingestion on the boundary ledger.
  const intelLatest = await getIntPointer("intel_latest_ledger");
  if (intelLatest == null) {
    throw new Error(
      "No intel_latest_ledger set — start the live ingestion pipeline first so we know where to begin backfill.",
    );
  }
  const start = intelLatest - 1;
  log.info({ intelLatest, start }, "First run — starting at intel_latest_ledger - 1");
  return start;
}

/* ------------------------------------------------------------------ */
/*  Marketplace registry loader                                        */
/* ------------------------------------------------------------------ */

async function loadMarketplaceMap(): Promise<Map<string, string>> {
  const rows = await db.select().from(marketplaceRegistry);
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.address, row.name);
  log.info({ count: map.size }, "Loaded marketplace registry");
  return map;
}

/* ------------------------------------------------------------------ */
/*  Worker pool                                                        */
/* ------------------------------------------------------------------ */

interface BackfillState {
  /** Per-client ingest contexts. Workers pick by `workerId % contexts.length`
   * so concurrent ledger fetches spread across multiple WS connections instead
   * of multiplexing through one socket — that was the throughput ceiling at
   * concurrency=20 (single shared XrplClient = single WS = endpoint-side
   * request rate cap). One client per endpoint URL gives ~Nx parallel streams.
   */
  contexts: IngestContext[];
  /** Shared in-memory queue; workers pop from the back. */
  queue: number[];
  /** Per-ledger retry counter. Incremented on transient errors (slowDown,
   * tooBusy, WS disconnects). After MAX_RETRIES the ledger is logged as a
   * gap and dropped. Cleared once a ledger ingests successfully. */
  retries: Map<number, number>;
  /** Lowest ledger we'll process (inclusive). Floor of the walk. */
  floor: number;
  /** Where to resume queue refills from. Mutated as chunks are loaded. */
  nextLedger: number;
  /** Stats for periodic logging + final summary. */
  processed: number;
  /** Count of ledgers requeued due to slowDown/transient errors — visibility
   * into how hard we're being throttled. */
  transientRequeues: number;
  startTime: number;
  lastLogAt: number;
  /** Set when SIGINT/SIGTERM is received. Workers stop pulling from queue. */
  running: boolean;
}

/** Max requeue attempts before giving up on a ledger and logging a gap.
 * 10 covers extended slowDown bursts (e.g., a Clio cluster doing a heavy
 * scan, briefly rejecting all incoming requests). With exponential backoff
 * this gives ~210s of total wait before the gap is logged, which is enough
 * for any normal endpoint hiccup to clear. Validation showed 5 was tight
 * — ~1 gap/min was leaking through under sustained load. */
const MAX_RETRIES = 10;
/** Initial backoff for the first retry. Each subsequent retry doubles up
 * to the cap. Tight-looping makes throttling worse — the endpoint needs
 * breathing room for its internal queue to drain. */
const TRANSIENT_BACKOFF_BASE_MS = 2_000;
/** Cap on per-retry backoff. Beyond this, we'd just be sleeping for nothing
 * — a slowDown that hasn't cleared in 30s is probably structural and won't
 * clear in 60s either. Better to keep retrying every 30s and let the
 * endpoint recover at whatever pace it does. */
const TRANSIENT_BACKOFF_MAX_MS = 30_000;

/** Backoff schedule: 2s, 4s, 8s, 16s, 30s, 30s, 30s, 30s, 30s, 30s.
 * Total max wait across MAX_RETRIES=10: ~210s. */
function getTransientBackoffMs(attempt: number): number {
  return Math.min(TRANSIENT_BACKOFF_BASE_MS * 2 ** (attempt - 1), TRANSIENT_BACKOFF_MAX_MS);
}

/** Refill the queue from the next chunk. Returns true if any work was added. */
function refillQueue(state: BackfillState): boolean {
  if (!state.running) return false;
  if (state.nextLedger <= state.floor) return false;

  const chunkMin = Math.max(state.floor + 1, state.nextLedger - CHUNK_SIZE + 1);
  for (let l = state.nextLedger; l >= chunkMin; l--) {
    state.queue.push(l);
  }
  state.nextLedger = chunkMin - 1;
  return true;
}

/** A single worker — pulls from the queue, calls ingestLedger, repeats.
 * Resilient: lgrNotFound logs to PG and continues; other errors warn but
 * don't stop the worker.
 *
 * Worker picks its IngestContext (and thus its WS connection) by
 * `workerId % contexts.length`. With N endpoints, we get N parallel streams
 * — workers pinned to the same stream serialize through that endpoint, but
 * different streams run independently. This is the parallelism mechanism. */
async function worker(workerId: number, state: BackfillState): Promise<void> {
  const ctx = state.contexts[workerId % state.contexts.length];
  while (state.running) {
    const idx = state.queue.pop();
    if (idx === undefined) {
      // Queue empty — try to refill from the main loop. Workers don't refill
      // themselves; the main loop coordinates that to keep contention low.
      return;
    }

    try {
      await ingestLedger(ctx, idx);
      state.processed++;
      // Clear retry counter on success — frees memory and means a ledger
      // that previously throttled gets a fresh budget if it ever needs to
      // be reprocessed (it won't, since the queue won't enqueue it again,
      // but we keep the map small).
      state.retries.delete(idx);
      // In replay mode, every successful ingestion is a gap recovery — mark
      // it resolved so the next replay run skips it. In walk mode we don't
      // bother (cheaper not to UPDATE per ledger when there's no gap to
      // resolve in 99.9999% of cases).
      if (REPLAY_GAPS_MODE) {
        await markGapResolved(idx);
      }
    } catch (err) {
      if (isLedgerNotFound(err)) {
        // Real gap — ledger doesn't exist on this endpoint. Log + skip.
        const errMsg = err instanceof Error
          ? err.message
          : (typeof err === "object" ? JSON.stringify(err).slice(0, 500) : String(err));
        await logBackfillGap(idx, `lgrNotFound: ${errMsg}`);
        log.warn({ workerId, ledgerIndex: idx }, "ledger lgrNotFound — logged as gap");
        state.retries.delete(idx);
      } else if (isTransientError(err)) {
        // Throttle or connection blip. Requeue (so a different worker on
        // a different endpoint can try) and back off this worker briefly.
        const count = (state.retries.get(idx) ?? 0) + 1;
        if (count >= MAX_RETRIES) {
          // Out of attempts — log gap and move on. Better to have a hole
          // than to wedge the queue forever on one bad ledger.
          state.retries.delete(idx);
          const errMsg = err instanceof Error
            ? err.message
            : (typeof err === "object" ? JSON.stringify(err).slice(0, 500) : String(err));
          await logBackfillGap(idx, `transient_max_retries: ${errMsg}`);
          log.warn(
            { workerId, ledgerIndex: idx, retries: count },
            "transient error exhausted retries — logged as gap",
          );
        } else {
          state.retries.set(idx, count);
          state.queue.push(idx);
          state.transientRequeues++;
          // Only log every 100th requeue so slowDown bursts don't spam logs.
          if (state.transientRequeues % 100 === 0) {
            log.warn(
              { workerId, ledgerIndex: idx, retries: count, totalRequeues: state.transientRequeues },
              "transient error — requeued (sample)",
            );
          }
          // Exponential backoff (2s, 4s, 8s, 16s, then capped at 30s).
          // Each retry waits longer, giving the endpoint progressively more
          // recovery time. This is what reduces the gap rate from ~1/min
          // (constant 2s × 5 retries) to near-zero.
          await new Promise((r) => setTimeout(r, getTransientBackoffMs(count)));
        }
      } else {
        // Unknown error class — log loudly and skip (current safety behavior).
        log.warn(
          { workerId, ledgerIndex: idx, err: err instanceof Error ? err.message : err },
          "ingestLedger failed — skipping",
        );
        state.retries.delete(idx);
        // Brief backoff so a bad endpoint or DB hiccup doesn't tight-loop the worker.
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }

    // Periodic log line — match the old script's shape so any existing
    // log-scrapers keep working: nextLedger / processed / rate / eta.
    if (state.processed > 0 && state.processed % LOG_INTERVAL === 0 && Date.now() - state.lastLogAt > 1_000) {
      state.lastLogAt = Date.now();
      const elapsedSec = (Date.now() - state.startTime) / 1000;
      const rate = state.processed / elapsedSec;
      const remaining = Math.max(0, state.nextLedger - state.floor) + state.queue.length;
      const etaHours = rate > 0 ? remaining / rate / 3600 : Infinity;

      // Cheap snapshot of unresolved gaps — helpful signal during long runs.
      let gapCount = 0;
      try {
        const rows = await db.execute<{ cnt: number }>(
          sql`SELECT count(*)::int AS cnt FROM backfill_gaps WHERE resolved_at IS NULL`,
        );
        gapCount = Number(rows[0]?.cnt ?? 0);
      } catch { /* table missing on a fresh deploy is fine */ }

      log.info(
        {
          processed: state.processed,
          rate: Number(rate.toFixed(1)),
          nextLedger: state.nextLedger,
          queueDepth: state.queue.length,
          etaHours: Number(etaHours.toFixed(1)),
          gaps: gapCount,
          transientRequeues: state.transientRequeues,
          retriesPending: state.retries.size,
        },
        "backfill progress",
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  log.info({
    mode: REPLAY_GAPS_MODE ? "replay-gaps" : "walk-back",
    concurrency: CONCURRENCY,
    chunkSize: CHUNK_SIZE,
    ledgersBack: LEDGERS_BACK,
    wsEndpoints: WS_ENDPOINTS,
    logInterval: LOG_INTERVAL,
  }, "Starting backfill");

  /* ── Build XRPL client pool ──
   * One XrplClient per endpoint URL. Each client owns one WS connection.
   * Workers route by `workerId % pool.length`, giving us N independent
   * parallel request streams instead of multiplexing through a single
   * socket. This is the throughput-scaling mechanism — single-socket
   * was the ceiling at ~10 ledgers/sec because the upstream endpoint
   * processes our request stream at its own rate. */
  const xrpls = WS_ENDPOINTS.map((url) => new XrplClient([url]));
  log.info(
    { poolSize: xrpls.length, endpoints: WS_ENDPOINTS },
    "Initialized XRPL client pool",
  );

  const marketplaceMap = await loadMarketplaceMap();

  /* ── Build per-client ingest contexts ──
   * Same shape across all contexts; only the `xrpl` field differs.
   * marketplaceMap and trackedAccountSet are shared by reference — the
   * map is read-only after load and the set is empty + never mutated
   * during backfill (cost basis intentionally off for historical data). */
  const baseCtxFields = {
    marketplaceMap,
    // Empty — backfill must NOT compute cost basis events for historical
    // data (would corrupt current per-account running totals).
    trackedAccountSet: new Set<string>(),
    captureNftUris: false,
    queueTokenIcons: false,
    writeClickHouse: true,
    // Backfill skips Neo4j — multiple concurrent workers MERGE on shared
    // Account nodes, which deadlocks against the live runner and itself
    // and slows backfill to ~1 ledger/sec. Live runner keeps writing
    // Neo4j forward; historical graph gets populated post-CH-completion
    // via a one-shot scripts/backfill-neo4j-from-ch.ts pass.
    writeNeo4j: false,
    // PG-write toggles: skip current-state-only tables that would either
    // be redundant or actively wrong if backfilled with historical events.
    // amm_pools is a current-state lookup — replaying historical AMMCreate
    // for since-deleted pools would corrupt it. token_metadata is already
    // covered by the live runner for currently-active tokens. The PG
    // recent_nft_trades buffer is dead-on-arrival post-cutover (CH
    // nft_trades is the source of truth). ingested_ledgers is replaced
    // by CH ledger_metadata for gap detection. All four together save
    // ~4-5 PG round-trips per ledger across 5 workers.
    writeAmmPools: false,
    writeTokenMetadata: false,
    writeRecentNftTrades: false,
    writeIngestedLedgers: false,
    // Deprecated PG hourly aggregations have no readers post-cutover —
    // skipping saves ~6 PG round-trips per ledger × number of hour buckets
    // touched. CH MVs (mv_fee_burn_hourly, mv_token_volume_hourly, etc.)
    // get the same data from the CH source-table inserts above.
    writeDeprecatedPgAggregations: false,
  };
  const contexts: IngestContext[] = xrpls.map((xrpl) => ({
    ...baseCtxFields,
    xrpl,
  }));

  /* ── Determine walk bounds (or load gap queue in replay mode) ── */
  let initialQueue: number[] = [];
  let nextLedger: number;
  let floor: number;

  if (REPLAY_GAPS_MODE) {
    // Replay mode — load unresolved gaps from PG, partition into safe-to-replay
    // and partial-write buckets, log the partial set for separate handling, and
    // pre-populate the queue with safe gaps. The floor is set to the lowest
    // gap so refillQueue is a no-op (no walk-back happens in replay mode).
    const { safeToReplay, partialWrite } = await loadUnresolvedGaps();
    log.info(
      { safeCount: safeToReplay.length, partialCount: partialWrite.length },
      "Replay-gaps mode — loaded unresolved gaps",
    );
    if (partialWrite.length > 0) {
      log.warn(
        { count: partialWrite.length, ledgers: partialWrite.slice(0, 20) },
        "Partial-write gaps SKIPPED — re-ingesting these would double-count in MV "
          + "SummingMergeTree targets. Need a partition-recompute pass to recover.",
      );
    }
    if (safeToReplay.length === 0) {
      log.info("No safe-to-replay gaps — exiting");
      await pgClient.end();
      return;
    }
    initialQueue = safeToReplay;
    floor = Math.min(...safeToReplay) - 1; // refillQueue stops at floor
    nextLedger = floor; // already at floor → no walk-back
  } else {
    nextLedger = await determineStart();

    /* Floor selection — three layers, in priority order:
     *
     *   1. BACKFILL_TARGET_LEDGER env (absolute, deterministic). When set,
     *      the script never walks below this ledger, period. No pointer
     *      math, no first-run state. This is the lever to use once you
     *      know the depth you want retained.
     *
     *   2. First-run-derived floor (persistent, crash-safe). On the very
     *      first run with no env override, anchor the floor to
     *      `intel_latest_at_first_run - LEDGERS_BACK` and store the latest
     *      in `ingestion_state.backfill_first_run_latest`. All subsequent
     *      runs reuse that anchor — so a crash-restart does NOT extend the
     *      walk past the original target. Reset by deleting the row in PG.
     *
     *   3. Legacy `pointer - LEDGERS_BACK` (fallback). Only kicks in if
     *      both env is unset and PG read fails (transient DB error).
     *      Preserves the old behavior in degenerate failure modes so we
     *      don't end up with floor=0 and walk to genesis.
     *
     * The original bug — floor recomputed from a moving pointer on each
     * restart — is what caused the runaway walk that ate prod disk on
     * 2026-05-07. Crash-restarts under disk pressure walked an extra
     * ~5 months past the intended 12-month target before the loop was
     * caught and stopped. */
    const intelLatest = await getIntPointer("intel_latest_ledger");
    let floorMode: string;
    if (TARGET_LEDGER != null) {
      floor = TARGET_LEDGER;
      floorMode = "env BACKFILL_TARGET_LEDGER";
    } else {
      let firstRunLatest = await getIntPointer("backfill_first_run_latest").catch(
        () => null,
      );
      if (firstRunLatest == null && intelLatest != null) {
        // First run — anchor to the current latest and persist.
        firstRunLatest = intelLatest;
        await setIntPointer("backfill_first_run_latest", firstRunLatest).catch(
          (err) =>
            log.warn(
              { err },
              "Failed to persist backfill_first_run_latest — will fall through to pointer-relative on next restart (NOT IDEAL)",
            ),
        );
        floorMode = "first-run-derived (anchor stored now)";
      } else if (firstRunLatest != null) {
        floorMode = "first-run-derived (anchor read from PG)";
      } else {
        // Neither env nor PG anchor available — degraded fallback.
        firstRunLatest = nextLedger;
        floorMode = "legacy pointer-relative (degraded — DB read failed)";
      }
      floor = Math.max(1, firstRunLatest - LEDGERS_BACK);
    }

    log.info(
      {
        start: nextLedger,
        floor,
        total: nextLedger - floor,
        mode: floorMode,
      },
      "Walk bounds",
    );
    if (nextLedger <= floor) {
      log.info("Already at or below floor — nothing to do");
      await pgClient.end();
      return;
    }
  }

  const state: BackfillState = {
    contexts,
    queue: initialQueue,
    retries: new Map<number, number>(),
    floor,
    nextLedger,
    processed: 0,
    transientRequeues: 0,
    startTime: Date.now(),
    lastLogAt: Date.now(),
    running: true,
  };

  /* ── Signal handlers ── */
  const onSignal = (sig: string) => {
    if (!state.running) return; // already shutting down
    log.info({ signal: sig }, "Signal received — stopping workers, draining in-flight");
    state.running = false;
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  /* ── Drive workers ── */
  // Outer loop: refill the queue until we hit the floor or get stopped.
  // Inner loop: run all workers in parallel; when they all return (queue
  // empty), refill and re-spawn. Each "round" = one queue refill + drain.
  while (state.running && (state.nextLedger > state.floor || state.queue.length > 0)) {
    // Top off the queue with up to CONCURRENCY chunks so workers don't
    // immediately hit an empty queue and exit. Chunk size * concurrency
    // gives a comfortable headroom for one drain cycle.
    while (state.running && state.queue.length < CONCURRENCY * CHUNK_SIZE && state.nextLedger > state.floor) {
      if (!refillQueue(state)) break;
    }

    if (state.queue.length === 0) break;

    // Spawn N workers; wait for the queue to drain.
    const workers: Promise<void>[] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(worker(i, state));
    }
    await Promise.all(workers);

    // Persist checkpoint after each round. Use the lowest ledger still
    // remaining (nextLedger + 1 because nextLedger was already decremented
    // past it on refill). Actually: state.nextLedger holds the index
    // BELOW the last enqueued ledger, so the next run should resume from
    // state.nextLedger — re-enqueueing it is safe (ingestLedger is
    // idempotent via the CH dedup probe + PG ON CONFLICT).
    //
    // Replay mode skips checkpoint writes — it processes from a finite
    // gap list, not a walk pointer, and clobbering the walk-mode pointer
    // would advance the main backfill past where it actually is.
    if (!REPLAY_GAPS_MODE) {
      try {
        await setIntPointer("backfill_next_ledger", state.nextLedger);
      } catch (err) {
        log.warn({ err, nextLedger: state.nextLedger }, "Failed to persist backfill checkpoint");
      }
    }
  }

  /* ── Drain timeout if shutdown was requested mid-round ── */
  if (!state.running) {
    log.info({ drainMs: SHUTDOWN_DRAIN_MS }, "Draining in-flight workers");
    // The worker loop above already exits when state.running flips to false,
    // and we already awaited Promise.all. This is just a safety pause for
    // any straggler async writes (CH/Neo4j) ingestLedger fired before the
    // flag flip. Bounded so we don't hang.
    await new Promise((resolve) => setTimeout(resolve, Math.min(SHUTDOWN_DRAIN_MS, 5_000)));
    if (!REPLAY_GAPS_MODE) {
      try {
        await setIntPointer("backfill_next_ledger", state.nextLedger);
      } catch (err) {
        log.warn({ err }, "Final checkpoint persist failed");
      }
    }
  }

  /* ── Final summary ── */
  let gapCount = 0;
  try {
    const rows = await db.execute<{ cnt: number }>(
      sql`SELECT count(*)::int AS cnt FROM backfill_gaps WHERE resolved_at IS NULL`,
    );
    gapCount = Number(rows[0]?.cnt ?? 0);
  } catch {
    // backfill_gaps may not exist on a fresh deploy.
  }

  const elapsedSec = (Date.now() - state.startTime) / 1000;
  const elapsedH = elapsedSec / 3600;
  const rate = state.processed / Math.max(elapsedSec, 1);

  log.info(
    {
      status: state.running ? "complete" : "stopped",
      processed: state.processed,
      gaps: gapCount,
      elapsedSec: Number(elapsedSec.toFixed(1)),
      elapsedHours: Number(elapsedH.toFixed(2)),
      rate: Number(rate.toFixed(1)),
      nextLedger: state.nextLedger,
      floor: state.floor,
    },
    state.running ? "Backfill complete" : "Backfill stopped",
  );

  // Mirror old script's primary log-line shape too, for any scrapers.
  console.log(
    `[backfill-history] ${state.running ? "complete" : "stopped"} — processed ${state.processed.toLocaleString()} ledgers, ${gapCount.toLocaleString()} unresolved gaps, ${elapsedH.toFixed(2)}h elapsed`,
  );

  /* ── Tear down PG pool ── */
  try {
    await pgClient.end();
  } catch (err) {
    log.warn({ err }, "PG pool close failed");
  }

  // The XrplClient pool keeps its WS connections open until the process
  // dies — there's no public `close()` method on XrplClient. Without an
  // explicit exit the event loop stays alive on the open sockets and the
  // script hangs after work completes (especially noticeable in replay
  // mode where the 'main' loop finishes in seconds). Forcing exit here
  // is safe because all PG/CH/WS writes have already been awaited.
  process.exit(0);
}

main().catch((err) => {
  log.error({ err }, "Fatal backfill error");
  console.error("[backfill-history] fatal:", err);
  process.exit(1);
});
