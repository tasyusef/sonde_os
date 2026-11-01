/**
 * One XRPL WebSocket connection with failover, keepalive, and primary
 * recovery. Isomorphic (global `WebSocket`: browsers and Node ≥ 22), so the
 * server `XrplClient` and the browser `XrplProvider` share one policy.
 *
 * Policy:
 * - Start on `urls[0]` (the primary).
 * - A socket that never opens, or dies within `STABLE_MS` of opening, is a
 *   node failure: rotate to the next URL with exponential backoff.
 * - A stable socket that drops (idle timeout, node restart) is not a node
 *   failure: reconnect to the same URL after the base delay.
 * - Keepalive: `ping` every `keepaliveMs`. Public nodes drop idle sockets,
 *   and a ping that times out means the socket is dead even if no close
 *   event has arrived.
 * - On a fallback, probe the primary every `probeIntervalMs`. If the switch
 *   back fails (primary dies within `STABLE_MS`), the interval doubles up to
 *   `maxProbeIntervalMs`, so a flaky primary can't cause churn.
 * - Switching nodes drains the old socket: requests already sent on it
 *   still resolve; it closes once they finish.
 * - Rate limits are per node (and per IP). A `slowDown` / `tooBusy` reply
 *   benches that node for its "retry in" hint, switches to the next node
 *   that isn't benched, and re-sends the request there once. With every
 *   node benched, the error goes to the caller.
 */

/** In preference order, the same as the relay's (`relay/src/nodes.rs`).
 *  Ripple's s2/s1 lead (full history). honeycluster is the non-Ripple
 *  backup. xrplcluster is last: it answered `tooBusy` at low load. */
export const XRPL_NODES: readonly string[] = [
  "wss://s2.ripple.com",
  "wss://s1.ripple.com",
  "wss://honeycluster.io",
  "wss://xrplcluster.com",
];

/** A connection that lives this long counts as healthy. */
const STABLE_MS = 10_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
/** Upper bound on how long a draining socket stays open after a switch. */
const DRAIN_TIMEOUT_MS = 30_000;
/** Bench time for a rate-limited node when its reply has no retry hint. */
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 120_000;

const RATE_LIMIT_ERRORS = new Set(["slowDown", "tooBusy"]);

/** True for a node's "you're sending too much" reply. */
function isRateLimitError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    RATE_LIMIT_ERRORS.has(String((err as { error?: unknown }).error))
  );
}

/** How long to bench a node that rate-limited us. Uses the node's hint
 *  ("retry in ~45189ms") when present, clamped to a sane range. */
export function rateLimitCooldownMs(err: unknown): number {
  const message = String((err as { error_message?: unknown } | null)?.error_message ?? "");
  const hint = /retry in ~?(\d+)\s*ms/i.exec(message);
  const ms = hint ? Number(hint[1]) : RATE_LIMIT_COOLDOWN_MS;
  return Math.min(Math.max(ms, BASE_RECONNECT_DELAY_MS), MAX_RATE_LIMIT_COOLDOWN_MS);
}

export interface XrplSocketOptions {
  urls?: readonly string[];
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  keepaliveMs?: number;
  probeIntervalMs?: number;
  maxProbeIntervalMs?: number;
  maxReconnectDelayMs?: number;
  /** Fires when a socket opens or closes. */
  onStatus?: (status: { connected: boolean; url: string }) => void;
  /** Fires after each open — re-subscribe streams here. */
  onOpen?: (info: { url: string; isPrimary: boolean }) => void;
  /** Messages that aren't responses to a request (ledger/transaction streams). */
  onStream?: (data: Record<string, unknown>) => void;
  onLog?: (level: "info" | "warn", message: string, context?: Record<string, unknown>) => void;
  /** Injected in tests. */
  WebSocketImpl?: typeof WebSocket;
}

export interface XrplRequestOptions {
  timeoutMs?: number;
  /** Wait for a connection (across failover) instead of failing fast. */
  waitForOpen?: boolean;
  /** Reject with `signal.reason` once it fires. A request not yet on
   *  the wire is never sent; one already sent is forgotten (the node
   *  still answers it, and the reply is dropped). */
  signal?: AbortSignal;
}

interface Pending {
  ws: WebSocket;
  command: Record<string, unknown>;
  timeoutMs: number | undefined;
  signal: AbortSignal | undefined;
  /** Already re-sent once after a rate limit. */
  retried: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Waiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class XrplSocket {
  private readonly urls: readonly string[];
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly keepaliveMs: number;
  private readonly baseProbeIntervalMs: number;
  private readonly maxProbeIntervalMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly opts: XrplSocketOptions;
  private readonly WS: typeof WebSocket;

  private ws: WebSocket | null = null;
  private isOpen = false;
  private openedAt = 0;
  private stopped = true;
  private urlIndex = 0;
  private reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
  private probeIntervalMs: number;
  /** Set while a fresh switch to the primary hasn't proven stable yet. */
  private switchedToPrimary = false;
  private requestId = 0;
  private pending = new Map<number, Pending>();
  private waiters = new Set<Waiter>();
  private probeSocket: WebSocket | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  /** URL index → time its rate-limit bench ends. */
  private benchedUntil = new Map<number, number>();

  constructor(opts: XrplSocketOptions = {}) {
    this.opts = opts;
    this.urls = opts.urls?.length ? opts.urls : XRPL_NODES;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 8_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 8_000;
    this.keepaliveMs = opts.keepaliveMs ?? 20_000;
    this.baseProbeIntervalMs = opts.probeIntervalMs ?? 60_000;
    this.maxProbeIntervalMs = opts.maxProbeIntervalMs ?? 600_000;
    this.maxReconnectDelayMs = opts.maxReconnectDelayMs ?? 15_000;
    this.probeIntervalMs = this.baseProbeIntervalMs;
    this.WS = opts.WebSocketImpl ?? globalThis.WebSocket;
  }

  get connected(): boolean {
    return this.isOpen;
  }

  /** URL of the open (or currently attempted) node. */
  get url(): string {
    return this.urls[this.urlIndex];
  }

  /** Idempotent. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.urlIndex = 0;
    this.connect();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer("reconnectTimer");
    this.stopProbe();
    const ws = this.ws;
    this.ws = null;
    this.teardown();
    if (ws) this.closeSocket(ws);
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error("XRPL WebSocket stopped"));
    }
    this.waiters.clear();
  }

  /**
   * Skip the reconnect backoff and try now, starting over from the
   * primary (or the first node that isn't benched). No-op while a socket
   * is open or a connection attempt is in flight.
   */
  reconnectNow(): void {
    if (this.stopped || this.isOpen || this.connectTimer) return;
    this.clearTimer("reconnectTimer");
    this.reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
    this.urlIndex = 0;
    if (this.isBenched(0)) this.urlIndex = this.nextUsableIndex() ?? 0;
    this.connect();
  }

  request(command: Record<string, unknown>, opts: XrplRequestOptions = {}): Promise<unknown> {
    return this.send(command, opts, false);
  }

  private async send(
    command: Record<string, unknown>,
    opts: XrplRequestOptions,
    retried: boolean,
  ): Promise<unknown> {
    const { signal } = opts;
    signal?.throwIfAborted();
    if (!this.isOpen) {
      if (!opts.waitForOpen || this.stopped) throw new Error("XRPL WebSocket not connected");
      await this.whenOpen(signal);
      signal?.throwIfAborted();
    }
    const ws = this.ws!;
    const id = (this.requestId = (this.requestId % 2_000_000_000) + 1);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(signal!.reason);
        if (p.ws !== this.ws) this.closeIfDrained(p.ws);
      };
      const settle =
        <A,>(fn: (a: A) => void) =>
        (a: A) => {
          signal?.removeEventListener("abort", onAbort);
          fn(a);
        };
      const timer = setTimeout(() => {
        const p = this.pending.get(id);
        if (p && this.pending.delete(id)) p.reject(new Error("Request timed out"));
      }, opts.timeoutMs ?? this.requestTimeoutMs);
      this.pending.set(id, {
        ws,
        command,
        timeoutMs: opts.timeoutMs,
        signal,
        retried,
        resolve: settle(resolve),
        reject: settle(reject),
        timer,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        ws.send(JSON.stringify({ ...command, id }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.get(id)?.reject(err);
        this.pending.delete(id);
      }
    });
  }

  /* ---- connection lifecycle ------------------------------------- */

  private connect(): void {
    if (this.stopped) return;
    const url = this.url;
    let ws: WebSocket;
    try {
      ws = new this.WS(url);
    } catch {
      this.scheduleReconnect(true);
      return;
    }
    this.ws = ws;
    this.isOpen = false;

    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (ws !== this.ws || this.isOpen) return;
      this.log("warn", "Connect timed out", { url });
      this.drop(ws);
    }, this.connectTimeoutMs);

    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.clearTimer("connectTimer");
      this.isOpen = true;
      this.openedAt = Date.now();
      this.reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
      const isPrimary = this.urlIndex === 0;
      this.log("info", "Connected", { url, isPrimary });
      this.startKeepalive(ws);
      if (isPrimary) this.stopProbe();
      else this.scheduleProbe();
      this.opts.onStatus?.({ connected: true, url });
      this.opts.onOpen?.({ url, isPrimary });
      for (const w of this.waiters) {
        clearTimeout(w.timer);
        w.resolve();
      }
      this.waiters.clear();
    };

    // Responses resolve even on a draining socket; streams only count on
    // the active one (the new socket re-subscribes on open).
    ws.onmessage = (event: MessageEvent) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const id = typeof data.id === "number" ? data.id : undefined;
      const cb = id !== undefined ? this.pending.get(id) : undefined;
      if (cb && id !== undefined) {
        this.pending.delete(id);
        clearTimeout(cb.timer);
        if (isRateLimitError(data)) this.handleRateLimit(cb, data);
        else if (data.status === "error" || data.error) cb.reject(data);
        else cb.resolve(data.result);
        if (cb.ws !== this.ws) this.closeIfDrained(cb.ws);
        return;
      }
      if (ws === this.ws && id === undefined) this.opts.onStream?.(data);
    };

    // `error` is always followed by `close`, which does the handling.
    ws.onerror = () => {};
    ws.onclose = () => {
      this.rejectPendingFor(ws, "WebSocket connection closed");
      if (ws === this.ws) this.handleLoss(ws);
    };
  }

  /** Force-close the active socket and handle it now — a dead TCP
   *  connection can take minutes to emit `close`. */
  private drop(ws: WebSocket): void {
    if (ws !== this.ws) return;
    this.handleLoss(ws);
    this.closeSocket(ws);
  }

  private handleLoss(ws: WebSocket): void {
    const wasOpen = this.isOpen;
    const lived = wasOpen ? Date.now() - this.openedAt : 0;
    const wasPrimary = this.urlIndex === 0;
    this.ws = null;
    this.teardown(ws);
    if (this.stopped) return;

    if (wasOpen && lived >= STABLE_MS) {
      if (wasPrimary) this.switchedToPrimary = false;
      this.log("info", "Connection dropped, reconnecting to the same node", { url: this.url });
      this.scheduleReconnect(false);
      return;
    }
    if (wasPrimary && this.switchedToPrimary) {
      this.switchedToPrimary = false;
      this.probeIntervalMs = Math.min(this.probeIntervalMs * 2, this.maxProbeIntervalMs);
      this.log("warn", "Primary failed after switching back; probing less often", {
        probeIntervalMs: this.probeIntervalMs,
      });
    }
    this.scheduleReconnect(true);
  }

  /** Clears per-connection state. Pending requests on `ws` are rejected. */
  private teardown(ws?: WebSocket): void {
    const wasOpen = this.isOpen;
    const url = this.url;
    this.isOpen = false;
    this.clearTimer("connectTimer");
    this.clearKeepalive();
    if (ws) this.rejectPendingFor(ws, "WebSocket connection closed");
    else this.rejectAllPending("XRPL WebSocket stopped");
    if (wasOpen) this.opts.onStatus?.({ connected: false, url });
  }

  private scheduleReconnect(rotate: boolean): void {
    if (this.stopped) return;
    this.clearTimer("reconnectTimer");
    let delay = BASE_RECONNECT_DELAY_MS;
    if (rotate) {
      this.urlIndex = this.nextUsableIndex() ?? (this.urlIndex + 1) % this.urls.length;
      delay = this.reconnectDelayMs;
      this.reconnectDelayMs = Math.min(delay * 2, this.maxReconnectDelayMs);
    }
    // Jitter spreads reconnects when many clients lose the same node.
    const jitter = Math.random() * Math.min(delay * 0.3, 2_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay + jitter);
  }

  /* ---- keepalive ------------------------------------------------- */

  private startKeepalive(ws: WebSocket): void {
    this.clearKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (ws !== this.ws || !this.isOpen) return;
      if (this.urlIndex === 0 && Date.now() - this.openedAt >= STABLE_MS) {
        this.switchedToPrimary = false;
        this.probeIntervalMs = this.baseProbeIntervalMs;
      }
      this.request({ command: "ping" }).catch((err) => {
        // A rate-limit reply proves the socket is alive.
        if (ws !== this.ws || isRateLimitError(err)) return;
        this.log("warn", "Keepalive ping failed, reconnecting", { url: this.url });
        this.drop(ws);
      });
    }, this.keepaliveMs);
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  /* ---- primary recovery ------------------------------------------ */

  private scheduleProbe(): void {
    this.stopProbe();
    if (this.urls.length < 2) return;
    const benched = (this.benchedUntil.get(0) ?? 0) - Date.now();
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      this.probe();
    }, Math.max(this.probeIntervalMs, benched));
  }

  private probe(): void {
    if (this.stopped || this.urlIndex === 0) return;
    let probe: WebSocket;
    try {
      probe = new this.WS(this.urls[0]);
    } catch {
      this.scheduleProbe();
      return;
    }
    this.probeSocket = probe;
    const finish = (ok: boolean) => {
      if (this.probeSocket !== probe) return;
      this.probeSocket = null;
      clearTimeout(timeout);
      this.closeSocket(probe);
      if (this.stopped || this.urlIndex === 0) return;
      if (ok) this.switchToPrimary();
      else this.scheduleProbe();
    };
    const timeout = setTimeout(() => finish(false), this.connectTimeoutMs);
    probe.onopen = () => finish(true);
    probe.onerror = () => {};
    probe.onclose = () => finish(false);
  }

  private stopProbe(): void {
    this.clearTimer("probeTimer");
    const probe = this.probeSocket;
    this.probeSocket = null;
    if (probe) this.closeSocket(probe);
  }

  private switchToPrimary(): void {
    this.log("info", "Primary reachable, switching back", { url: this.urls[0] });
    this.switchTo(0);
    this.switchedToPrimary = true;
  }

  /** Move to another node now, draining the current socket. */
  private switchTo(index: number): void {
    const old = this.ws;
    this.ws = null;
    // Not `teardown(old)`: requests in flight on the old socket keep going.
    const wasOpen = this.isOpen;
    const oldUrl = this.url;
    this.isOpen = false;
    this.clearTimer("connectTimer");
    this.clearKeepalive();
    if (wasOpen) this.opts.onStatus?.({ connected: false, url: oldUrl });
    if (old) this.drain(old);
    this.stopProbe();
    this.urlIndex = index;
    this.reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
    this.switchedToPrimary = false;
    this.connect();
  }

  /* ---- rate limits ----------------------------------------------- */

  private handleRateLimit(cb: Pending, err: unknown): void {
    // Only the active node's reply benches it; a draining socket's node
    // was already left behind.
    if (cb.ws === this.ws) {
      const cooldownMs = rateLimitCooldownMs(err);
      this.benchedUntil.set(this.urlIndex, Date.now() + cooldownMs);
      const next = this.nextUsableIndex();
      if (next !== null) {
        this.log("warn", "Node rate-limited us, switching", {
          url: this.url,
          next: this.urls[next],
          cooldownMs,
        });
        this.switchTo(next);
      } else {
        this.log("warn", "Every node is rate-limiting us", { cooldownMs });
      }
    }
    if (cb.retried || this.stopped || this.isBenched(this.urlIndex)) {
      cb.reject(err);
      return;
    }
    this.send(cb.command, { timeoutMs: cb.timeoutMs, signal: cb.signal, waitForOpen: true }, true).then(
      cb.resolve,
      cb.reject,
    );
  }

  private isBenched(index: number): boolean {
    const until = this.benchedUntil.get(index);
    if (until === undefined) return false;
    if (Date.now() < until) return true;
    this.benchedUntil.delete(index);
    return false;
  }

  /** Next node after the current one that isn't benched, or null. */
  private nextUsableIndex(): number | null {
    for (let step = 1; step < this.urls.length; step++) {
      const index = (this.urlIndex + step) % this.urls.length;
      if (!this.isBenched(index)) return index;
    }
    return null;
  }

  /* ---- helpers --------------------------------------------------- */

  private whenOpen(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        reject(signal!.reason);
      };
      const done =
        <A,>(fn: (a: A) => void) =>
        (a: A) => {
          signal?.removeEventListener("abort", onAbort);
          fn(a);
        };
      const waiter: Waiter = {
        resolve: done(resolve),
        reject: done(reject),
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          waiter.reject(new Error("XRPL WebSocket connection timed out"));
        }, this.connectTimeoutMs + 2_000),
      };
      this.waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private drain(ws: WebSocket): void {
    if (this.closeIfDrained(ws)) return;
    setTimeout(() => this.closeSocket(ws), DRAIN_TIMEOUT_MS);
  }

  private closeIfDrained(ws: WebSocket): boolean {
    for (const p of this.pending.values()) if (p.ws === ws) return false;
    this.closeSocket(ws);
    return true;
  }

  private rejectPendingFor(ws: WebSocket, reason: string): void {
    for (const [id, p] of this.pending) {
      if (p.ws !== ws) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(new Error(reason));
    }
  }

  private rejectAllPending(reason: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private closeSocket(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  private clearTimer(name: "connectTimer" | "reconnectTimer" | "probeTimer"): void {
    const t = this[name];
    if (t) {
      clearTimeout(t);
      this[name] = null;
    }
  }

  private log(level: "info" | "warn", message: string, context?: Record<string, unknown>): void {
    this.opts.onLog?.(level, message, context);
  }
}
