/**
 * XrplProvider + useXrpl hook
 *
 * One browser-native WebSocket per tab that talks directly to XRPL public
 * nodes, so load is spread by user IP. Failover, keepalive and primary
 * recovery come from `XrplSocket`; `XrplRouter` sends Clio-only commands
 * (`nft_info`, `nft_history`) to a second, lazily opened Clio socket.
 *
 * `send(command, { timeoutMs })` waits for a connection, then for the
 * reply (8 s default timeout).
 *
 * `unreachable` turns on when no node has been open for 15 s; views with
 * nothing to show render an alert whose retry calls `reconnect`.
 *
 * The main socket also subscribes to the ledger stream on every open;
 * `useLatestLedger()` reads it without re-rendering `useXrpl()` consumers.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { XrplRouter } from "@/lib/xrpl-router";
import { watchReachability, type Reachability } from "@/lib/xrpl-reachability";
import type { SendFn } from "@/lib/xrpl-pagination";
import {
  createLedgerTickStore,
  parseLedgerTick,
  type LedgerTick,
  type LedgerTickStore,
} from "@/lib/ledger-tick";

export interface XrplContextValue {
  /** Send an XRPL command and wait for the response. */
  send: SendFn;
  /** Whether the WebSocket is currently connected. */
  connected: boolean;
  /** True once the socket has connected at least once. Gate one-shot
   *  queries on this, not `connected`: `send` waits out reconnects, and
   *  a key that flips to null on every drop would blank the page. */
  ready: boolean;
  /** Hostname of the currently active XRPL node. */
  activeNode: string;
  /** No node has been open for `UNREACHABLE_AFTER_MS`. */
  unreachable: boolean;
  /** Try connecting now instead of waiting out the backoff. */
  reconnect: () => void;
}

/** From start, the last drop, or a retry. Long enough for a slow first
 *  node to fail over; short enough that a dead network isn't a
 *  skeleton forever. */
const UNREACHABLE_AFTER_MS = 15_000;

const XrplContext = createContext<XrplContextValue | null>(null);
const LedgerTickContext = createContext<LedgerTickStore | null>(null);

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function XrplProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeNode, setActiveNode] = useState("");
  const [unreachable, setUnreachable] = useState(false);
  const socketRef = useRef<XrplRouter | null>(null);
  const reachRef = useRef<Reachability | null>(null);
  const [ledgerTicks] = useState(createLedgerTickStore);

  useEffect(() => {
    const reach = watchReachability(UNREACHABLE_AFTER_MS, setUnreachable);
    reachRef.current = reach;
    // Log each failing node once, not on every retry during an outage.
    let lastWarnedUrl: string | null = null;
    const socket = new XrplRouter({
      maxReconnectDelayMs: 60_000,
      probeIntervalMs: 120_000,
      onStatus: ({ connected: isConnected, url }) => {
        reach.status(isConnected);
        setConnected(isConnected);
        if (isConnected) setReady(true);
        setActiveNode(hostname(url));
      },
      // Re-subscribes after every reconnect and failover. The reply
      // seeds the ledger until the first stream message lands.
      onOpen: () => {
        socket.main
          .request({ command: "subscribe", streams: ["ledger"] })
          .then((result) => {
            const tick = parseLedgerTick(result as Record<string, unknown>);
            if (tick) ledgerTicks.set(tick);
          })
          .catch(() => {});
      },
      onStream: (data) => {
        const tick = parseLedgerTick(data);
        if (tick) ledgerTicks.set(tick);
      },
      onLog: (level, message, context) => {
        if (level === "info") {
          if (message === "Connected") lastWarnedUrl = null;
          console.log(`[XRPL-Client] ${message}`, context ?? ""); // audit-ok
          return;
        }
        const url = typeof context?.url === "string" ? context.url : null;
        if (url && url === lastWarnedUrl) return;
        lastWarnedUrl = url;
        console.warn(`[XRPL-Client] ${message}`, context ?? ""); // audit-ok
      },
    });
    socketRef.current = socket;
    socket.start();
    return () => {
      socket.stop();
      reach.stop();
      socketRef.current = null;
      reachRef.current = null;
    };
  }, [ledgerTicks]);

  const send = useCallback<SendFn>((command, opts) => {
    const socket = socketRef.current;
    if (!socket) return Promise.reject(new Error("WebSocket not connected"));
    return socket.request(command, opts);
  }, []);

  const reconnect = useCallback(() => {
    if (reachRef.current?.retry()) socketRef.current?.reconnectNow();
  }, []);

  const contextValue = useMemo(
    () => ({ send, connected, ready, activeNode, unreachable, reconnect }),
    [send, connected, ready, activeNode, unreachable, reconnect],
  );

  return (
    <XrplContext.Provider value={contextValue}>
      <LedgerTickContext.Provider value={ledgerTicks}>{children}</LedgerTickContext.Provider>
    </XrplContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useXrpl(): XrplContextValue {
  const ctx = useContext(XrplContext);
  if (!ctx) throw new Error("useXrpl must be used within <XrplProvider>");
  return ctx;
}

/** The latest validated ledger, or `null` until the stream delivers one
 *  (and during prerender). */
export function useLatestLedger(): LedgerTick | null {
  const store = useContext(LedgerTickContext);
  if (!store) throw new Error("useLatestLedger must be used within <XrplProvider>");
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}
