/**
 * LiveDataManager — server-side singleton that subscribes to the XRPL ledger
 * stream, enriches each ledger close with network stats / fees / price, and
 * broadcasts snapshots to every connected SSE subscriber.
 *
 * Starts lazily on first subscriber.  Stops when no subscribers remain.
 */

import { xrplClient } from "./xrpl-client";
import {
  getNetworkStats,
  getRecentTransactions,
  getRecentNFTMints,
  getServerHealth,
  getFeeInfo,
  getLedgerTxDistribution,
} from "./xrpl-data";
import type { RecentMint } from "./xrpl-data";
import { getXrpPrice } from "./price-data";
import logger from "@/lib/logger";
import type {
  LedgerEvent,
  RecentTx,
  NetworkStats,
  PriceData,
} from "@/types/live-data";
import type {
  ServerHealth,
  FeeInfo,
  TxTypeDistribution,
} from "@/types/network";

/* ------------------------------------------------------------------ */
/*  Snapshot — the single object broadcast to every SSE subscriber     */
/* ------------------------------------------------------------------ */

export interface LiveDataSnapshot {
  /** Raw ledger-close event from the XRPL stream */
  ledger: LedgerEvent;
  /** 15 most-recent transactions from the validated ledger */
  transactions: RecentTx[];
  /** Total tx count in the validated ledger */
  txCount: number;
  /** Core network stats (reserves, base fee, total coins) */
  stats: NetworkStats;
  /** Real-time fee info */
  fee: FeeInfo | null;
  /** Server health (build version, load factor, state) */
  health: ServerHealth | null;
  /** Tx-type distribution for the validated ledger */
  txDistribution: TxTypeDistribution[];
  /** XRP price data (updated every 30 s, may lag 1 cycle) */
  price: PriceData | null;
  /** Rolling buffer of the 4 most recent NFTokenMint transactions */
  recentMints: RecentMint[];
}

type SubscriberCallback = (snapshot: LiveDataSnapshot) => void;

/* ------------------------------------------------------------------ */
/*  Manager class                                                      */
/* ------------------------------------------------------------------ */

class LiveDataManager {
  private subscribers = new Set<SubscriberCallback>();
  private unsubscribeLedger: (() => void) | null = null;
  private running = false;
  private fetching = false;

  /** Guards against concurrent start() calls */
  private startPromise: Promise<void> | null = null;

  /** Incremented on each start() so stale broadcasts are discarded */
  private sessionId = 0;

  /** Most recent price (polled every 30 s, not per-ledger) */
  private latestPrice: PriceData | null = null;
  private priceInterval: ReturnType<typeof setInterval> | null = null;

  /** Rolling buffer of the 4 most recent NFTokenMint transactions */
  private recentMints: RecentMint[] = [];
  private mintsSeeded = false;

  /* ---------- public API ---------- */

  /**
   * Register an SSE subscriber.  Returns an unsubscribe function the caller
   * MUST invoke when the stream closes (e.g. in ReadableStream.cancel()).
   */
  subscribe(cb: SubscriberCallback): () => void {
    this.subscribers.add(cb);

    if (!this.startPromise && !this.running) {
      this.startPromise = this.start()
        .catch((err) =>
          logger.error("[live-data] Failed to start:", err)
        )
        .finally(() => {
          this.startPromise = null;
        });
    }

    return () => {
      this.subscribers.delete(cb);
      if (this.subscribers.size === 0) {
        this.stop();
      }
    };
  }

  /* ---------- lifecycle ---------- */

  private async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const session = ++this.sessionId;
    logger.info("[live-data] Starting — subscribing to XRPL ledger stream");

    // Seed price immediately so the first snapshot includes it
    this.fetchPrice();

    // Seed recent mints so the first snapshot has historical data
    getRecentNFTMints()
      .then((mints) => {
        if (!this.mintsSeeded) {
          this.recentMints = mints;
          this.mintsSeeded = true;
        }
      })
      .catch(() => {
        // Seeding is best-effort — live mints will accumulate naturally
      });

    // Poll price every 30 s (external HTTP, not XRPL WS)
    this.priceInterval = setInterval(() => this.fetchPrice(), 30_000);

    try {
      const unsub = await xrplClient.subscribeLedger(
        (raw: unknown) => {
          const ledger = this.parseLedgerEvent(raw);
          if (ledger) this.onLedgerClose(ledger, session);
        }
      );

      // If stop() was called while we were awaiting, clean up immediately
      if (!this.running || this.sessionId !== session) {
        unsub();
        return;
      }

      this.unsubscribeLedger = unsub;
    } catch (err) {
      logger.error({ err }, "[live-data] subscribeLedger failed");
      this.running = false;
      this.mintsSeeded = false;
      this.recentMints = [];
      // Clean up the price interval that was started above
      if (this.priceInterval) {
        clearInterval(this.priceInterval);
        this.priceInterval = null;
      }
    }
  }

  stop(): void {
    logger.info("[live-data] Stopping — no subscribers remaining");
    this.running = false;
    this.fetching = false;

    this.unsubscribeLedger?.();
    this.unsubscribeLedger = null;

    if (this.priceInterval) {
      clearInterval(this.priceInterval);
      this.priceInterval = null;
    }

    // Reset state so next start() begins cleanly
    this.mintsSeeded = false;
    this.recentMints = [];
    this.latestPrice = null;
  }

  /* ---------- ledger-close handler ---------- */

  private onLedgerClose(ledger: LedgerEvent, session: number): void {
    // Discard events from a previous session (stale subscription)
    if (session !== this.sessionId) return;
    // Skip if a previous fetch cycle is still running (back-pressure)
    if (this.fetching) return;
    this.fetching = true;

    // .then(cleanup, cleanup) instead of .finally(cleanup) — .finally()
    // returns a chained promise that re-rejects on error, which surfaces
    // as an unhandledRejection (the ledger-close handler is fire-and-
    // forget, no caller catches the rejection). Same shape as the
    // xrplClient dedup bug fixed in commit a5fa56e.
    const release = () => { this.fetching = false; };
    this.enrichAndBroadcast(ledger, session).then(release, release);
  }

  /**
   * Fetch enriched data for this ledger close, then broadcast.
   *
   * Uses Promise.allSettled so a single failing call doesn't block
   * the entire snapshot — partial data is better than no data.
   *
   * Budget per ledger close:
   *   getRecentTransactions  → 1 XRPL message  (expanded ledger)
   *   getNetworkStats        → 2 XRPL messages  (ledger + server_info)
   *   getFeeInfo             → 1 XRPL message   (fee)
   *   getServerHealth        → 1 XRPL message   (server_info — may share cache with stats)
   *   getLedgerTxDistribution → 1 XRPL message  (expanded ledger — shared cache)
   *                           ≈ 3-4 net messages (after cache hits)
   *
   * At ~17 ledger closes / min  ⇒  ~53–68 messages / min  (well within 1 000 / min)
   */
  private async enrichAndBroadcast(
    ledger: LedgerEvent,
    session: number,
  ): Promise<void> {
    const [recentResult, statsResult, feeResult, healthResult, distResult] =
      await Promise.allSettled([
        getRecentTransactions(),
        getNetworkStats(),
        getFeeInfo(),
        getServerHealth(),
        getLedgerTxDistribution(),
      ]);

    // Log rejection reasons for debugging (partial data is still broadcast)
    const labels = ["getRecentTransactions", "getNetworkStats", "getFeeInfo", "getServerHealth", "getLedgerTxDistribution"];
    [recentResult, statsResult, feeResult, healthResult, distResult].forEach((result, i) => {
      if (result.status === "rejected") {
        logger.warn(`[live-data] ${labels[i]} failed:`, result.reason);
      }
    });

    const recent =
      recentResult.status === "fulfilled" ? recentResult.value : null;
    const stats =
      statsResult.status === "fulfilled" ? statsResult.value : null;
    const fee = feeResult.status === "fulfilled" ? feeResult.value : null;
    const health =
      healthResult.status === "fulfilled" ? healthResult.value : null;
    const dist =
      distResult.status === "fulfilled" ? distResult.value : null;

    // Network stats are essential — if they fail, build a minimal fallback
    // from the ledger event itself so the snapshot is still usable.
    const resolvedStats: NetworkStats = stats ?? {
      ledgerIndex: ledger.ledger_index,
      txCount: ledger.txn_count,
      closeTime: ledger.ledger_time,
      totalCoins: "0",
      baseFee: "0.000012",
      reserveBase: 1,
      reserveIncrement: 0.2,
    };

    // Update rolling recent-mints buffer with any new mints from this ledger
    const newMints = recent?.mints ?? [];
    if (newMints.length > 0) {
      this.mintsSeeded = true;
      const combined = [...newMints, ...this.recentMints];
      const seen = new Set<string>();
      this.recentMints = combined
        .filter((m) => {
          if (seen.has(m.hash)) return false;
          seen.add(m.hash);
          return true;
        })
        .slice(0, 4);
    }

    // Attach per-tx summaries and total fees to the ledger event for dot grids.
    // Fallback: if getRecentTransactions failed but the expanded ledger is in
    // cache (populated by getLedgerTxDistribution), build minimal summaries so
    // the dot grid still renders.
    let txSummaries = recent?.txSummaries;
    let totalFees = recent?.totalFees;

    if (!txSummaries && ledger.txn_count > 0) {
      try {
        const fallback = await xrplClient.getLedger("validated", true);
        const txs = fallback.ledger.transactions ?? [];
        let feeSum = 0n;
        txSummaries = txs.map((tx) => {
          try { feeSum += BigInt(tx.Fee ?? "0"); } catch { /* skip */ }
          return {
            hash: tx.hash,
            type: tx.TransactionType,
            result: tx.meta?.TransactionResult ?? tx.metaData?.TransactionResult ?? "",
          };
        });
        totalFees = feeSum.toString();
      } catch {
        // Both paths failed — dot grid will show "No transaction data"
      }
    }

    const enrichedLedger = {
      ...ledger,
      txSummaries,
      totalFees,
    };

    const snapshot: LiveDataSnapshot = {
      ledger: enrichedLedger,
      transactions: recent?.txs ?? [],
      txCount: recent?.total ?? ledger.txn_count,
      stats: resolvedStats,
      fee,
      health,
      txDistribution: dist?.distribution ?? [],
      price: this.latestPrice,
      recentMints: this.recentMints,
    };

    // Re-check session — a stop/start may have occurred during fetch
    if (session !== this.sessionId) return;

    this.broadcast(snapshot);
    this.persistRecentLedger(ledger);
  }

  /* ---------- price polling ---------- */

  private fetchPrice(): void {
    getXrpPrice()
      .then((p) => {
        this.latestPrice = p;
      })
      .catch((err) => {
        logger.warn({ err }, "[live-data] Price fetch failed");
        // Keep stale price — better than null
      });
  }

  /* ---------- recent ledger ring buffer ---------- */

  private static readonly MAX_RECENT_LEDGERS = 201;

  /**
   * Insert the ledger into recent_ledgers and trim rows beyond the cap.
   * Fire-and-forget — DB failure must never block the live pipeline.
   */
  private persistRecentLedger(ledger: LedgerEvent): void {
    import("@/db")
      .then(({ client }) =>
        client`
          WITH ins AS (
            INSERT INTO recent_ledgers (ledger_index, txn_count, ledger_time)
            VALUES (${ledger.ledger_index}, ${ledger.txn_count}, ${ledger.ledger_time})
            ON CONFLICT (ledger_index) DO NOTHING
          )
          DELETE FROM recent_ledgers
          WHERE ledger_index NOT IN (
            SELECT ledger_index FROM recent_ledgers
            ORDER BY ledger_index DESC
            LIMIT ${LiveDataManager.MAX_RECENT_LEDGERS}
          )
        `,
      )
      .catch(() => {
        // DB unavailable — silently ignore
      });
  }

  /* ---------- helpers ---------- */

  private broadcast(snapshot: LiveDataSnapshot): void {
    for (const cb of this.subscribers) {
      try {
        cb(snapshot);
      } catch {
        // Never let a bad subscriber take down the loop
      }
    }
  }

  private parseLedgerEvent(raw: unknown): LedgerEvent | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const index = Number(obj.ledger_index ?? 0);
    // Reject events missing a valid ledger index
    if (!index) return null;
    return {
      ledger_index: index,
      ledger_hash: String(obj.ledger_hash ?? ""),
      ledger_time: Number(obj.ledger_time ?? 0),
      txn_count: Number(obj.txn_count ?? 0),
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Singleton export                                                   */
/* ------------------------------------------------------------------ */

const globalForLiveData = globalThis as unknown as { liveDataManager?: LiveDataManager };
export const liveDataManager = globalForLiveData.liveDataManager ?? (globalForLiveData.liveDataManager = new LiveDataManager());

if (typeof process !== "undefined") {
  // Use `once` to avoid accumulating listeners on HMR re-evaluations
  const shutdown = () => { liveDataManager.stop(); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
