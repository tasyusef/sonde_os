/**
 * Standalone XRPL ledger ingester — Hetzner-deployed live runner.
 *
 * Subscribes to `ledgerClosed`, processes each ledger via
 * `ingestLedger(ctx, idx)`, and runs continuously. Replaces the in-process
 * `IngestionManager` + `IntelIngestionManager` pair; those still ship with
 * the Railway app for now but are not started when this runner is active.
 *
 * Owns:
 *   - `.env.local` load (dotenv)
 *   - A dedicated XrplClient (NOT the page-serving singletons)
 *   - Marketplace registry + tracked accounts loading + reload intervals
 *   - Live ledger subscription with serial promise chain
 *   - Startup gap fill + periodic gap detection (5min)
 *   - SIGTERM/SIGINT graceful shutdown
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/run-ingester.ts
 *
 * Required env:
 *   DATABASE_URL, CLICKHOUSE_URL
 *
 * Optional env:
 *   INGESTER_WS_ENDPOINTS   Comma-separated WS URLs (default: honeycluster + s2.ripple)
 *   INGESTER_GAP_LIMIT      Max ledgers per gap-fill cycle (default 50)
 *   LOG_LEVEL               pino level (default debug in dev, info in prod)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingestionState,
  marketplaceRegistry,
  trackedAccounts,
} from "@/db/schema";
import { client as pgClient } from "@/db";
import { XrplClient } from "@/lib/xrpl-client";
import { ingestLedger, type IngestContext } from "@/lib/ledger-ingester";
import * as ch from "@/lib/clickhouse-client";
import logger from "@/lib/logger";

const log = logger.child({ module: "run-ingester" });

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

/** Marketplace registry reload interval: 60 minutes. */
const REGISTRY_RELOAD_INTERVAL = 60 * 60 * 1000;
/** Tracked accounts reload interval: 60 seconds (so wallet sign-ins land fast). */
const TRACKED_ACCOUNTS_RELOAD_INTERVAL = 60 * 1000;
/** Gap detection interval: 5 minutes. */
const GAP_CHECK_INTERVAL = 5 * 60 * 1000;
/** Max gap-fill ledgers per cycle (rate-limit safe). */
const MAX_GAP_FILL_PER_CYCLE = parseInt(process.env.INGESTER_GAP_LIMIT ?? "50", 10);
/** How far back from chain tip to check for gaps. The backward-walking
 *  backfill owns everything older than this window — running gap detection
 *  there would compete uselessly with backfill. 5000 ledgers ≈ 5.5h of
 *  chain, more than enough to catch dropped `ledgerClosed` events. */
const GAP_DETECTION_WINDOW = parseInt(process.env.INGESTER_GAP_WINDOW ?? "5000", 10);

const WS_ENDPOINTS = (process.env.INGESTER_WS_ENDPOINTS ??
  "wss://honeycluster.io,wss://s2.ripple.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/* ------------------------------------------------------------------ */
/*  Validate env                                                       */
/* ------------------------------------------------------------------ */

if (!process.env.DATABASE_URL) {
  log.error("DATABASE_URL required");
  process.exit(1);
}
if (!process.env.CLICKHOUSE_URL) {
  log.error("CLICKHOUSE_URL required");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  Runner                                                             */
/* ------------------------------------------------------------------ */

class Runner {
  private xrpl: XrplClient;
  private marketplaceMap = new Map<string, string>();
  private trackedAccountSet = new Set<string>();

  /** Serialises ledger processing — at most one ingestLedger runs at a time. */
  private chain: Promise<void> = Promise.resolve();
  /** True while a live ledger is processing — gap fill skips and lets the
   *  serial chain catch up rather than queueing competing work. */
  private liveProcessing = false;

  private unsubscribeLedger: (() => void) | null = null;
  private registryTimer: ReturnType<typeof setInterval> | null = null;
  private trackedTimer: ReturnType<typeof setInterval> | null = null;
  private gapTimer: ReturnType<typeof setInterval> | null = null;

  private shuttingDown = false;

  constructor() {
    this.xrpl = new XrplClient(WS_ENDPOINTS);
  }

  /** Build the per-call IngestContext. Same map references are shared across
   *  calls so reloaders mutate them in place. */
  private ctx(): IngestContext {
    return {
      xrpl: this.xrpl,
      marketplaceMap: this.marketplaceMap,
      trackedAccountSet: this.trackedAccountSet,
      captureNftUris: true,
      queueTokenIcons: true,
      writeClickHouse: true,
    };
  }

  async start(): Promise<void> {
    log.info({ wsEndpoints: WS_ENDPOINTS }, "Starting unified ingester");

    /* ── Initial loads ── */
    await this.loadMarketplaceRegistry();
    await this.loadTrackedAccounts();

    /* ── Subscribe to ledger close stream ── */
    this.unsubscribeLedger = await this.xrpl.subscribeLedger((raw: unknown) => {
      const ledgerIndex = parseLedgerIndex(raw);
      if (!ledgerIndex) return;

      // Skip if already processing — the serial chain or the gap-fill
      // sweep will catch this ledger. Prevents unbounded queue growth
      // when a ledger takes longer than 4s.
      if (this.liveProcessing) return;
      this.liveProcessing = true;
      this.chain = this.chain
        .then(() => ingestLedger(this.ctx(), ledgerIndex))
        .catch((err) => {
          log.error({ err, ledgerIndex }, "Live ledger processing error");
        })
        .finally(() => {
          this.liveProcessing = false;
        });
    });

    /* ── Reload timers ── */
    this.registryTimer = setInterval(() => {
      this.loadMarketplaceRegistry().catch((err) =>
        log.error({ err }, "Marketplace registry reload failed"),
      );
    }, REGISTRY_RELOAD_INTERVAL);

    this.trackedTimer = setInterval(() => {
      this.loadTrackedAccounts().catch((err) =>
        log.error({ err }, "Tracked accounts reload failed"),
      );
    }, TRACKED_ACCOUNTS_RELOAD_INTERVAL);

    /* ── Startup gap fill ── */
    await this.fillStartupGap();

    /* ── Periodic gap detection ── */
    this.gapTimer = setInterval(() => {
      this.detectAndFillGaps().catch((err) =>
        log.error({ err }, "Gap detection failed"),
      );
    }, GAP_CHECK_INTERVAL);

    log.info("Ingester running — listening for ledgerClosed");
  }

  /** On startup, check `intel_latest_ledger` against the chain tip and
   *  enqueue every missing ledger between them. Caps to MAX_GAP_FILL_PER_CYCLE
   *  per call — subsequent gap-fill ticks will pick up the rest. */
  private async fillStartupGap(): Promise<void> {
    let lastIntel = 0;
    try {
      const [row] = await db
        .select()
        .from(ingestionState)
        .where(sql`${ingestionState.key} = 'intel_latest_ledger'`)
        .limit(1);
      lastIntel = row ? Number(row.value) : 0;
    } catch (err) {
      log.warn({ err }, "Failed to load intel_latest_ledger pointer");
      return;
    }

    if (lastIntel === 0) {
      log.info("No intel_latest_ledger checkpoint — skipping startup gap fill");
      return;
    }

    let chainTip = 0;
    try {
      // Use validated ledger as the tip — same as everything else.
      const tip = await this.xrpl.getLedger("validated", false);
      chainTip = Number(tip?.ledger?.ledger_index ?? 0);
    } catch (err) {
      log.warn({ err }, "Failed to fetch chain tip — skipping startup gap fill");
      return;
    }

    if (chainTip <= lastIntel) {
      log.info({ lastIntel, chainTip }, "No startup gap");
      return;
    }

    const gap = chainTip - lastIntel;
    const cap = Math.min(gap, MAX_GAP_FILL_PER_CYCLE);
    log.info({ lastIntel, chainTip, gap, cap }, "Filling startup gap");

    for (let i = 1; i <= cap; i++) {
      const idx = lastIntel + i;
      this.chain = this.chain
        .then(() => ingestLedger(this.ctx(), idx))
        .catch((err) => log.warn({ err, ledgerIndex: idx }, "Startup gap fill ledger failed"));
    }
  }

  /** Periodic gap detection — finds holes in CH `ledger_metadata` for the
   *  recent window and enqueues fills. Skips when a live ledger is
   *  processing so we don't pile work on top of in-flight writes.
   *
   *  Window-limited (`GAP_DETECTION_WINDOW`) so we don't compete with the
   *  backward-walking backfill on the historical range — backfill owns
   *  everything older than the window. The window covers any gaps from
   *  dropped `ledgerClosed` events when live processing was busy.
   *
   *  Uses CH `ledger_metadata` (not PG `ingested_ledgers`) because backfill
   *  no longer writes the PG table — `ledger_metadata` is the new source
   *  of truth for ledger coverage. */
  private async detectAndFillGaps(): Promise<void> {
    if (this.shuttingDown) return;
    if (this.liveProcessing) return;

    let latest = 0;
    try {
      const [latestRow] = await db
        .select()
        .from(ingestionState)
        .where(sql`${ingestionState.key} = 'latest_ledger'`);
      latest = Number(latestRow?.value ?? 0);
    } catch (err) {
      log.warn({ err }, "Failed to read latest_ledger for gap detection");
      return;
    }

    if (latest === 0) return;

    const earliest = Math.max(1, latest - GAP_DETECTION_WINDOW);
    if (earliest >= latest) return;

    let ingested: { ledger_index: number }[];
    try {
      ingested = await ch.query<{ ledger_index: number }>(
        `SELECT ledger_index FROM ledger_metadata
         WHERE ledger_index BETWEEN {earliest:UInt32} AND {latest:UInt32}`,
        { earliest, latest },
      );
    } catch (err) {
      log.warn({ err }, "CH ledger_metadata gap query failed");
      return;
    }

    const ingestedSet = new Set(ingested.map((r) => Number(r.ledger_index)));
    const gaps: number[] = [];
    for (let i = earliest; i <= latest && gaps.length < MAX_GAP_FILL_PER_CYCLE; i++) {
      if (!ingestedSet.has(i)) gaps.push(i);
    }

    if (gaps.length === 0) return;

    log.info({ gaps: gaps.length, window: GAP_DETECTION_WINDOW }, "Filling gaps");
    for (const idx of gaps) {
      if (this.shuttingDown) break;
      this.chain = this.chain
        .then(() => ingestLedger(this.ctx(), idx))
        .catch((err) => log.warn({ err, ledgerIndex: idx }, "Gap fill ledger failed"));
    }
  }

  private async loadMarketplaceRegistry(): Promise<void> {
    const rows = await db.select().from(marketplaceRegistry);
    this.marketplaceMap.clear();
    for (const row of rows) {
      this.marketplaceMap.set(row.address, row.name);
    }
    log.info({ count: this.marketplaceMap.size }, "Loaded marketplace registry");
  }

  private async loadTrackedAccounts(): Promise<void> {
    const rows = await db
      .select({ address: trackedAccounts.address })
      .from(trackedAccounts);
    this.trackedAccountSet = new Set(rows.map((r) => r.address));
    log.info({ count: this.trackedAccountSet.size }, "Loaded tracked accounts");
  }

  /** Graceful shutdown — wait for in-flight ledger to finish, then close
   *  PG pool. Caller decides exit code. */
  async stop(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    log.info("Shutting down ingester");

    if (this.unsubscribeLedger) {
      try { this.unsubscribeLedger(); } catch { /* ignore */ }
      this.unsubscribeLedger = null;
    }
    for (const t of [this.registryTimer, this.trackedTimer, this.gapTimer]) {
      if (t) clearInterval(t);
    }
    this.registryTimer = null;
    this.trackedTimer = null;
    this.gapTimer = null;

    // Wait for the serial chain to drain — bounded by a generous timeout
    // in case a ledger is wedged on a slow store.
    const drain = this.chain.catch(() => {});
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 30_000));
    await Promise.race([drain, timeout]);

    // Close the PG pool last so in-flight writes had a chance to finish.
    try {
      await pgClient.end();
      log.info("PG pool closed");
    } catch (err) {
      log.warn({ err }, "PG pool close failed");
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseLedgerIndex(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const index = Number(obj.ledger_index ?? 0);
  return Number.isFinite(index) && index > 0 ? index : null;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const runner = new Runner();

  let exitCode = 0;
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Signal received");
    try {
      await runner.stop();
    } catch (err) {
      log.error({ err }, "Shutdown failed");
      exitCode = 1;
    }
    process.exit(exitCode);
  };

  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
  process.on("SIGINT", () => { shutdown("SIGINT"); });

  // Surface unhandled errors loudly. We don't crash the process on
  // unhandledRejection because XRPL WS races can produce them benignly,
  // but they're worth logging.
  process.on("unhandledRejection", (reason) => {
    log.error({ reason }, "Unhandled rejection");
  });
  process.on("uncaughtException", (err) => {
    log.error({ err }, "Uncaught exception — exiting");
    runner.stop().finally(() => process.exit(1));
  });

  await runner.start();

  // Never returns — runner is event-driven from this point.
}

main().catch((err) => {
  log.error({ err }, "Fatal startup error");
  process.exit(1);
});
