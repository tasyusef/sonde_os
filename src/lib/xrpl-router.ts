/**
 * Routes browser XRPL requests to the right `XrplSocket`.
 *
 * - Most commands go to the main socket (`XRPL_NODES`, failover order).
 * - Clio-only commands go to a second socket on Ripple's Clio nodes. The
 *   main socket can fail over to plain rippled (xrplcluster), which
 *   answers them with `unknownCmd`. That socket opens on the first
 *   Clio-only request and closes after `clioIdleMs` with nothing in
 *   flight, so pages that never need it never open it.
 * - `fullHistory` requests also go to Clio: s2 keeps all of history, so
 *   its "not found" is final where a pruned node's isn't.
 *
 * Requests wait for a connection (across failover) instead of failing
 * fast, so a call made mid-reconnect still lands.
 */

import { XrplSocket, type XrplRequestOptions, type XrplSocketOptions } from "./xrpl-socket";

/** Commands only Clio serves. */
export const CLIO_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "nft_info",
  "nft_history",
  "nfts_by_issuer",
]);

export const CLIO_NODES: readonly string[] = ["wss://s2.ripple.com", "wss://s1.ripple.com"];

const CLIO_IDLE_MS = 60_000;

export function isClioOnly(command: Record<string, unknown>): boolean {
  return CLIO_ONLY_COMMANDS.has(String(command.command));
}

export interface XrplRouterRequestOptions extends XrplRequestOptions {
  /** Send to the full-history (Clio) socket. */
  fullHistory?: boolean;
}

export interface XrplRouterOptions extends XrplSocketOptions {
  clioUrls?: readonly string[];
  clioIdleMs?: number;
}

export class XrplRouter {
  readonly main: XrplSocket;
  private clio: XrplSocket | null = null;
  private clioInFlight = 0;
  private clioIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly opts: XrplRouterOptions = {}) {
    this.main = new XrplSocket(opts);
  }

  start(): void {
    this.stopped = false;
    this.main.start();
  }

  stop(): void {
    this.stopped = true;
    this.main.stop();
    this.stopClio();
  }

  /** Retry the connection now instead of waiting out the backoff. */
  reconnectNow(): void {
    this.main.reconnectNow();
    this.clio?.reconnectNow();
  }

  request(
    command: Record<string, unknown>,
    { fullHistory, ...opts }: XrplRouterRequestOptions = {},
  ): Promise<unknown> {
    if (this.stopped) return Promise.reject(new Error("XRPL WebSocket stopped"));
    const options = { waitForOpen: true, ...opts };
    if (!fullHistory && !isClioOnly(command)) return this.main.request(command, options);

    const socket = this.clioSocket();
    this.clioInFlight++;
    return socket.request(command, options).finally(() => {
      this.clioInFlight--;
      if (this.clioInFlight === 0 && this.clio === socket) this.scheduleClioIdle();
    });
  }

  private clioSocket(): XrplSocket {
    if (this.clioIdleTimer) {
      clearTimeout(this.clioIdleTimer);
      this.clioIdleTimer = null;
    }
    if (!this.clio) {
      this.clio = new XrplSocket({
        urls: this.opts.clioUrls ?? CLIO_NODES,
        connectTimeoutMs: this.opts.connectTimeoutMs,
        requestTimeoutMs: this.opts.requestTimeoutMs,
        maxReconnectDelayMs: this.opts.maxReconnectDelayMs,
        onLog: this.opts.onLog,
        WebSocketImpl: this.opts.WebSocketImpl,
      });
      this.clio.start();
    }
    return this.clio;
  }

  private scheduleClioIdle(): void {
    this.clioIdleTimer = setTimeout(() => {
      this.clioIdleTimer = null;
      if (this.clioInFlight === 0) this.stopClio();
    }, this.opts.clioIdleMs ?? CLIO_IDLE_MS);
  }

  private stopClio(): void {
    if (this.clioIdleTimer) clearTimeout(this.clioIdleTimer);
    this.clioIdleTimer = null;
    this.clio?.stop();
    this.clio = null;
  }
}
