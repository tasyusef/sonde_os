// Server-only: XRPL WebSocket connection manager with failover
import WS from "ws";
import { transactionCache, accountCache, ledgerCache, nftCache } from "./cache";
import logger from "./logger";
import type {
  AccountInfoResponse,
  AccountTxResponse,
  AccountObjectsResponse,
  AccountOffersResponse,
  AccountNFTsResponse,
  TxResponse,
  LedgerResponse,
  ExpandedLedgerResponse,
  NFTInfoResponse,
  NFTOffersResponse,
  NFTHistoryResponse,
  LedgerEntryResponse,
  GatewayBalancesResponse,
  AccountLinesResponse,
  AMMInfoResponse,
  BookOffersResponse,
} from "@/types/xrpl-responses";

const log = logger.child({ module: "xrpl" });

const XRPL_URLS = [
  "wss://honeycluster.io",
  "wss://s2.ripple.com",
  "wss://xrplcluster.com",
  "wss://s1.ripple.com",
];
const MAX_MESSAGES_PER_MINUTE = 1000;
const MAX_RECONNECT_DELAY = 15000;
const CONNECT_TIMEOUT = 8000;
const REQUEST_TIMEOUT = 8000;
const PRIMARY_PROBE_INTERVAL = 60_000; // try to return to primary every 60s

type RequestCallback = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
};

/** Stream message for account transaction subscriptions */
export interface TransactionStream {
  transaction: {
    TransactionType: string;
    Account: string;
    Destination?: string;
    DestinationTag?: number;
    Amount?: string | { value: string; currency: string; issuer: string };
    hash: string;
    [key: string]: unknown;
  };
  meta?: {
    TransactionResult: string;
    [key: string]: unknown;
  };
  engine_result?: string;
  validated?: boolean;
}

type TransactionCallback = (tx: TransactionStream) => void;

export class XrplClient {
  private ws: WS | null = null;
  private requestId = 0;
  private pending = new Map<number, RequestCallback>();
  private messageTimestamps: number[] = [];
  private reconnectDelay = 1000;
  private connecting = false;
  private connected = false;
  private reconnecting = false;
  private ledgerCallbacks: Array<(ledger: unknown) => void> = [];
  private accountCallbacks = new Map<string, TransactionCallback[]>();
  private connectPromise: Promise<void> | null = null;
  private urlIndex = 0;
  private urls: string[];
  private primaryProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private switchingToPrimary = false;
  // In-flight dedup. When two read-style requests with identical bodies
  // arrive concurrently (e.g. the network page firing
  // getLedger("validated") from two parallel helpers, or two callers
  // hitting `server_info` at once), we share one round-trip + one
  // response cache fill. Cleared in `.finally` so retries fire fresh.
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(urls?: string[]) {
    this.urls = urls ?? XRPL_URLS;
    // Always start on the primary node (Honeycluster). Failover nodes
    // are only used if the primary goes down. Load distribution is
    // handled by pushing per-user requests to client-side WebSockets.
    this.urlIndex = 0;
  }

  /** Hostname of the currently active (or last attempted) XRPL node. */
  get activeNode(): string {
    const url = this.urls[this.urlIndex % this.urls.length];
    try { return new URL(url).hostname; } catch { return url; }
  }

  private ensureConnection(): Promise<void> {
    if (this.connected && this.ws?.readyState === WS.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connect();
    return this.connectPromise;
  }

  private connect(): Promise<void> {
    if (this.connecting && this.connectPromise) return this.connectPromise;
    this.connecting = true;

    const url = this.urls[this.urlIndex % this.urls.length];

    const promise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.connecting = false;
        this.connectPromise = null;
        this.reconnecting = true; // R1: prevent close handler from triggering a second rotateAndReconnect
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
        reject(new Error(`WebSocket connection timed out (${url})`));
        this.rotateAndReconnect();
      }, CONNECT_TIMEOUT);

      try {
        this.ws = new WS(url);

        this.ws.on("open", () => {
          clearTimeout(timeout);
          const isPrimary = url === this.urls[0];
          this.connected = true;
          this.connecting = false;
          this.reconnecting = false;
          this.reconnectDelay = 1000;
          this.urlIndex = 0; // reset so next failover retries primary first
          this.connectPromise = null;
          log.info({ url, isPrimary }, "Connected");
          // Re-subscribe to ledger stream after reconnect
          if (this.ledgerCallbacks.length > 0) {
            this.send({ command: "subscribe", streams: ["ledger"] }).catch(() => {});
          }
          // Re-subscribe to account transaction streams after reconnect
          if (this.accountCallbacks.size > 0) {
            this.send({
              command: "subscribe",
              accounts: Array.from(this.accountCallbacks.keys()),
            }).catch(() => {});
          }
          if (isPrimary) {
            this.stopPrimaryProbe();
          } else {
            this.startPrimaryProbe();
          }
          resolve();
        });

        this.ws.on("message", (raw) => {
          try {
            const data = JSON.parse(raw.toString());

            if (data.type === "ledgerClosed") {
              this.ledgerCallbacks.forEach((cb) => cb(data));
              return;
            }

            if (data.type === "transaction") {
              const tx = data as TransactionStream;
              // Dispatch to all accounts that have callbacks registered.
              // A transaction can affect multiple subscribed accounts
              // (e.g. sender and receiver), so check all.
              for (const [account, cbs] of this.accountCallbacks) {
                if (
                  tx.transaction.Account === account ||
                  tx.transaction.Destination === account
                ) {
                  cbs.forEach((cb) => cb(tx));
                }
              }
              return;
            }

            if (data.id !== undefined) {
              const cb = this.pending.get(data.id);
              if (cb) {
                this.pending.delete(data.id);
                if (data.status === "error" || data.error) {
                  cb.reject(data);
                } else {
                  cb.resolve(data.result);
                }
              }
            }
          } catch {
            // ignore parse errors
          }
        });

        this.ws.on("close", () => {
          clearTimeout(timeout);
          this.connected = false;
          this.connecting = false;
          this.connectPromise = null;
          this.rejectAllPending("WebSocket connection closed");
          if (this.switchingToPrimary) {
            // Primary probe succeeded — reconnect directly to primary (urlIndex already 0)
            this.switchingToPrimary = false;
            this.reconnectDelay = 1000;
            this.connect().catch(() => {});
          } else if (!this.reconnecting) {
            this.rotateAndReconnect();
          }
        });

        this.ws.on("error", () => {
          clearTimeout(timeout);
          this.reconnecting = true;
          this.connected = false;
          this.connecting = false;
          this.connectPromise = null;
          this.rejectAllPending("WebSocket error");
          log.error({ url }, "Connection failed");
          reject(new Error("WebSocket connection failed"));
          this.rotateAndReconnect();
        });
      } catch (err) {
        clearTimeout(timeout);
        this.connecting = false;
        this.connectPromise = null;
        reject(err);
      }
    });
    this.connectPromise = promise;
    return promise;
  }

  /** Reject all in-flight requests so callers don't hang */
  private rejectAllPending(reason: string): void {
    for (const [id, cb] of this.pending) {
      if (cb.timer) clearTimeout(cb.timer); // R4: cancel request timeout
      cb.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  /** Rotate to the next XRPL node URL and reconnect */
  private rotateAndReconnect(): void {
    this.urlIndex++;
    this.reconnecting = true;
    // R2: capture current delay and advance before scheduling — prevents
    // concurrent calls from reading the same delay value
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_DELAY);
    setTimeout(() => {
      this.reconnecting = false;
      this.connect().catch(() => {});
    }, delay);
  }

  /** Start a timer to periodically probe the primary node. */
  private startPrimaryProbe(): void {
    this.stopPrimaryProbe();
    this.primaryProbeTimer = setTimeout(() => {
      this.primaryProbeTimer = null;
      this.probePrimary();
    }, PRIMARY_PROBE_INTERVAL);
  }

  private stopPrimaryProbe(): void {
    if (this.primaryProbeTimer) {
      clearTimeout(this.primaryProbeTimer);
      this.primaryProbeTimer = null;
    }
  }

  /** Open a throwaway connection to the primary node. If it accepts,
   *  close the current fallback connection and reconnect to primary. */
  private probePrimary(): void {
    const primaryUrl = this.urls[0];
    let settled = false;

    const probe = new WS(primaryUrl);
    const probeTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { probe.close(); } catch { /* ignore */ }
      log.info("Primary probe timed out, retrying later");
      this.startPrimaryProbe();
    }, CONNECT_TIMEOUT);

    probe.on("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(probeTimeout);
      try { probe.close(); } catch { /* ignore */ }
      log.info({ url: primaryUrl }, "Primary recovered, switching back");
      this.switchingToPrimary = true;
      this.urlIndex = 0;
      this.ws?.close(); // close handler will reconnect to primary
    });

    probe.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(probeTimeout);
      log.info("Primary probe failed, retrying later");
      this.startPrimaryProbe();
    });
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    this.messageTimestamps = this.messageTimestamps.filter(
      (t) => now - t < 60000
    );
    return this.messageTimestamps.length < MAX_MESSAGES_PER_MINUTE;
  }

  async send(
    command: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown> {
    // Skip dedup for stream-mutating commands — subscribe/unsubscribe
    // change server-side subscription state, and the per-account
    // callback bookkeeping in subscribeAccount already handles its own
    // local dedup.
    const cmd = command.command as string | undefined;
    const skipDedup = cmd === "subscribe" || cmd === "unsubscribe";
    const dedupKey = skipDedup ? null : JSON.stringify(command);
    if (dedupKey != null) {
      const existing = this.inFlight.get(dedupKey);
      if (existing) return existing;
    }

    const promise = this.sendInternal(command, options);

    if (dedupKey != null) {
      this.inFlight.set(dedupKey, promise);
      const cleanup = () => {
        // Defensive identity check — a later call may have replaced the
        // entry between our set and this cleanup callback firing.
        if (this.inFlight.get(dedupKey) === promise) {
          this.inFlight.delete(dedupKey);
        }
      };
      // .then(cleanup, cleanup) handles both fulfillment and rejection,
      // returning a new promise that resolves with undefined. We must
      // NOT use .finally(cleanup) here — .finally() re-rejects on error,
      // which would surface as an unhandledRejection because the
      // returned `promise` is the one callers handle, not the chained
      // .finally() promise. This bug crash-looped sonde-backfill until
      // we caught it via the dedup paths firing on rippled error
      // responses (cb.reject(data) with the data object).
      promise.then(cleanup, cleanup);
    }

    return promise;
  }

  private async sendInternal(
    command: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown> {
    await this.ensureConnection();

    if (!this.checkRateLimit()) {
      throw new Error("Rate limit exceeded");
    }

    const id = ++this.requestId;
    this.messageTimestamps.push(Date.now());

    return new Promise((resolve, reject) => {
      const entry: RequestCallback = {
        resolve: (value) => {
          if (entry.timer) clearTimeout(entry.timer);
          resolve(value);
        },
        reject: (reason) => {
          if (entry.timer) clearTimeout(entry.timer);
          reject(reason);
        },
      };
      this.pending.set(id, entry);

      try {
        this.ws!.send(JSON.stringify({ ...command, id }));
      } catch (err) {
        if (entry.timer) clearTimeout(entry.timer);
        this.pending.delete(id);
        reject(err);
        return;
      }

      entry.timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("Request timed out"));
        }
      }, options?.timeoutMs ?? REQUEST_TIMEOUT);
    });
  }

  /**
   * Send with automatic retry on `slowDown` (XRPL rate limit).
   * Exponential backoff: 2s, 4s, 8s. Use for background tasks only.
   */
  async sendWithRetry(
    command: Record<string, unknown>,
    maxRetries = 3,
  ): Promise<unknown> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.send(command);
      } catch (err) {
        const isSlowDown =
          typeof err === "object" &&
          err !== null &&
          "error" in err &&
          (err as Record<string, unknown>).error === "slowDown";
        if (isSlowDown && attempt < maxRetries) {
          const delay = 2000 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Unreachable");
  }

  async getAccountInfo(address: string): Promise<AccountInfoResponse> {
    const cached = accountCache.get(`info:${address}`);
    if (cached) return cached as AccountInfoResponse;

    const result = await this.send({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    }) as AccountInfoResponse;
    if (result && typeof result === "object") {
      accountCache.set(`info:${address}`, result);
    }
    return result;
  }

  async getAccountTx(address: string, marker?: unknown): Promise<AccountTxResponse> {
    return this.send({
      command: "account_tx",
      account: address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 20,
      ...(marker ? { marker } : {}),
    }) as Promise<AccountTxResponse>;
  }

  async getAccountObjects(
    address: string,
    type?: string,
    marker?: unknown
  ): Promise<AccountObjectsResponse> {
    return this.send({
      command: "account_objects",
      account: address,
      ledger_index: "validated",
      limit: 50,
      ...(type ? { type } : {}),
      ...(marker ? { marker } : {}),
    }) as Promise<AccountObjectsResponse>;
  }

  async getAccountOffers(
    address: string,
    marker?: unknown
  ): Promise<AccountOffersResponse> {
    return this.send({
      command: "account_offers",
      account: address,
      ledger_index: "validated",
      limit: 50,
      ...(marker ? { marker } : {}),
    }) as Promise<AccountOffersResponse>;
  }

  async getAccountNFTs(address: string, marker?: unknown): Promise<AccountNFTsResponse> {
    return this.send({
      command: "account_nfts",
      account: address,
      limit: 50,
      ...(marker ? { marker } : {}),
    }) as Promise<AccountNFTsResponse>;
  }

  async getTransaction(hash: string): Promise<TxResponse> {
    const cached = transactionCache.get(hash);
    if (cached) return cached as TxResponse;

    const result = await this.send({
      command: "tx",
      transaction: hash,
      binary: false,
    }) as TxResponse;
    if (result && (result.hash || result.TransactionType)) {
      transactionCache.set(hash, result);
    }
    return result;
  }

  async getLedger(index?: number | "validated", expand?: false): Promise<LedgerResponse>;
  async getLedger(index: number | "validated" | undefined, expand: true): Promise<ExpandedLedgerResponse>;
  async getLedger(index?: number | "validated", expand = false): Promise<LedgerResponse | ExpandedLedgerResponse> {
    const key = `${index?.toString() ?? "validated"}:${expand ? "expanded" : "hashes"}`;
    const cached = ledgerCache.get(key);
    if (cached) return cached as LedgerResponse | ExpandedLedgerResponse;

    // Expanded ledger responses are heavy (100+ tx with full meta) and the
    // server can take 10-20s under concurrent load (multi-worker backfill
    // hitting the same socket). The 8s REQUEST_TIMEOUT default was tuned
    // for live single-shot calls; for any non-trivial workload we need
    // longer patience. 25s matches getGatewayBalances which faces the same
    // server-side scan-time cost.
    const result = await this.send(
      {
        command: "ledger",
        ledger_index: index ?? "validated",
        transactions: true,
        expand,
      },
      { timeoutMs: 25_000 },
    );
    ledgerCache.set(key, result);
    return result as LedgerResponse | ExpandedLedgerResponse;
  }

  async getNFTInfo(nftId: string): Promise<NFTInfoResponse> {
    const cached = nftCache.get(nftId);
    if (cached) return cached as NFTInfoResponse;

    const result = await this.send({
      command: "nft_info",
      nft_id: nftId,
    }) as NFTInfoResponse;
    nftCache.set(nftId, result);
    return result;
  }

  async getNFTBuyOffers(nftId: string, marker?: unknown): Promise<NFTOffersResponse> {
    return this.send({
      command: "nft_buy_offers",
      nft_id: nftId,
      limit: 500,
      ...(marker ? { marker } : {}),
    }) as Promise<NFTOffersResponse>;
  }

  async getNFTSellOffers(nftId: string, marker?: unknown): Promise<NFTOffersResponse> {
    return this.send({
      command: "nft_sell_offers",
      nft_id: nftId,
      limit: 500,
      ...(marker ? { marker } : {}),
    }) as Promise<NFTOffersResponse>;
  }

  async getNFTHistory(nftId: string, marker?: unknown): Promise<NFTHistoryResponse> {
    return this.send({
      command: "nft_history",
      nft_id: nftId,
      limit: 50,
      ...(marker ? { marker } : {}),
    }) as Promise<NFTHistoryResponse>;
  }

  async getLedgerEntry(index: string): Promise<LedgerEntryResponse> {
    return this.send({
      command: "ledger_entry",
      index,
      ledger_index: "validated",
    }) as Promise<LedgerEntryResponse>;
  }

  async getGatewayBalances(account: string): Promise<GatewayBalancesResponse> {
    // Heavy issuers (RLUSD, Bitstamp etc.) can take >8s to respond because
    // rippled scans every trust line server-side. Bumped to 25s so the call
    // succeeds instead of timing out for the largest issuers on the ledger.
    return this.send(
      {
        command: "gateway_balances",
        account,
        ledger_index: "validated",
      },
      { timeoutMs: 25_000 },
    ) as Promise<GatewayBalancesResponse>;
  }

  async getAccountLines(
    account: string,
    marker?: unknown,
  ): Promise<AccountLinesResponse> {
    return this.send({
      command: "account_lines",
      account,
      ledger_index: "validated",
      limit: 400,
      ...(marker ? { marker } : {}),
    }) as Promise<AccountLinesResponse>;
  }

  async getAMMInfo(ammAccount: string): Promise<AMMInfoResponse> {
    const cached = accountCache.get(`amm:${ammAccount}`);
    if (cached) return cached as AMMInfoResponse;

    const result = await this.send({
      command: "amm_info",
      amm_account: ammAccount,
      ledger_index: "validated",
    }) as AMMInfoResponse;
    if (result && typeof result === "object") {
      accountCache.set(`amm:${ammAccount}`, result);
    }
    return result;
  }

  async getAMMInfoByAssets(
    asset: { currency: string; issuer?: string },
    asset2: { currency: string; issuer?: string }
  ): Promise<AMMInfoResponse> {
    const cacheKey = `amm:${asset.currency}:${asset.issuer ?? ""}:${asset2.currency}:${asset2.issuer ?? ""}`;
    const cached = accountCache.get(cacheKey);
    if (cached) return cached as AMMInfoResponse;

    const a1: Record<string, string> = { currency: asset.currency };
    if (asset.issuer) a1.issuer = asset.issuer;
    const a2: Record<string, string> = { currency: asset2.currency };
    if (asset2.issuer) a2.issuer = asset2.issuer;

    const result = await this.send({
      command: "amm_info",
      asset: a1,
      asset2: a2,
      ledger_index: "validated",
    }) as AMMInfoResponse;
    if (result && typeof result === "object") {
      accountCache.set(cacheKey, result);
    }
    return result;
  }

  async getBookOffers(
    takerGets: { currency: string; issuer?: string },
    takerPays: { currency: string; issuer?: string },
    limit = 50
  ): Promise<BookOffersResponse> {
    const gets: Record<string, string> = { currency: takerGets.currency };
    if (takerGets.issuer) gets.issuer = takerGets.issuer;
    const pays: Record<string, string> = { currency: takerPays.currency };
    if (takerPays.issuer) pays.issuer = takerPays.issuer;

    return this.send({
      command: "book_offers",
      taker_gets: gets,
      taker_pays: pays,
      limit,
    }) as Promise<BookOffersResponse>;
  }

  /**
   * Subscribe to transaction stream for an account.
   * Callback fires for any validated transaction that affects the account.
   * Re-subscribes automatically on WS reconnect/failover.
   */
  async subscribeAccount(
    account: string,
    callback: TransactionCallback,
  ): Promise<() => void> {
    const existing = this.accountCallbacks.get(account);
    if (existing) {
      existing.push(callback);
    } else {
      this.accountCallbacks.set(account, [callback]);
      // Only send subscribe command if this is the first callback for this account
      await this.send({ command: "subscribe", accounts: [account] });
    }
    return () => this.unsubscribeAccount(account, callback);
  }

  /**
   * Remove a specific callback for an account. If no callbacks remain,
   * unsubscribe from the account on the XRPL node.
   */
  unsubscribeAccount(account: string, callback: TransactionCallback): void {
    const cbs = this.accountCallbacks.get(account);
    if (!cbs) return;
    const filtered = cbs.filter((cb) => cb !== callback);
    if (filtered.length === 0) {
      this.accountCallbacks.delete(account);
      this.send({ command: "unsubscribe", accounts: [account] }).catch(() => {});
    } else {
      this.accountCallbacks.set(account, filtered);
    }
  }

  async subscribeLedger(
    callback: (ledger: unknown) => void
  ): Promise<() => void> {
    this.ledgerCallbacks.push(callback);
    await this.send({
      command: "subscribe",
      streams: ["ledger"],
    });
    return () => {
      this.ledgerCallbacks = this.ledgerCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }
}

export const xrplClient = new XrplClient();

// Eagerly start the WebSocket connection at module load so it's
// ready when the first page request arrives (avoids cold-start latency).
xrplClient.send({ command: "ping" }).catch((err) =>
  log.warn({ err: err instanceof Error ? err.message : err }, "Warm-up ping failed"),
);
