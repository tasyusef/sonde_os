"use client";

/**
 * XrplProvider + useXrpl hook
 *
 * A single browser-native WebSocket per tab that talks directly to XRPL
 * public nodes.  Distributes load by user IP instead of funneling everything
 * through the server.
 *
 * Provides a `send(command)` function for request/response queries.
 * Connection lifecycle: starts on Honeycluster, failover across 4 nodes,
 * reconnection with exponential backoff. Automatically probes the primary
 * node every 60s when connected to a fallback.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const XRPL_URLS = [
  "wss://honeycluster.io",
  "wss://s2.ripple.com",
  "wss://xrplcluster.com",
  "wss://s1.ripple.com",
];

const REQUEST_TIMEOUT = 8_000;
const CONNECT_TIMEOUT = 8_000;
const MAX_RECONNECT_DELAY = 60_000;
const PRIMARY_PROBE_INTERVAL = 120_000;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type PendingCallback = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export interface XrplContextValue {
  /** Send an XRPL command and wait for the response. */
  send: (command: Record<string, unknown>) => Promise<unknown>;
  /** Whether the WebSocket is currently connected. */
  connected: boolean;
  /** Hostname of the currently active XRPL node. */
  activeNode: string;
}

const XrplContext = createContext<XrplContextValue | null>(null);

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function XrplProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [activeNode, setActiveNode] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef(new Map<number, PendingCallback>());
  const requestIdRef = useRef(0);
  const urlIndexRef = useRef(0);
  const reconnectDelayRef = useRef(1_000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primaryProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);
  const switchingToPrimaryRef = useRef(false);
  const lastErrorLogRef = useRef<string | null>(null);

  /* ---- lifecycle --------------------------------------------------- */

  // All WS callbacks live inside this effect so that forward refs resolve via
  // function hoisting — avoids the circular-useCallback pattern that trips
  // react-hooks/immutability. Runs once per mount; refs and state setters are
  // stable so empty deps are correct.
  useEffect(() => {
    mountedRef.current = true;

    function rejectAllPending(reason: string) {
      for (const [id, cb] of pendingRef.current) {
        cb.reject(new Error(reason));
        pendingRef.current.delete(id);
      }
    }

    function getHostname(idx: number) {
      const url = XRPL_URLS[idx % XRPL_URLS.length];
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    }

    function stopPrimaryProbe() {
      if (primaryProbeTimerRef.current) {
        clearTimeout(primaryProbeTimerRef.current);
        primaryProbeTimerRef.current = null;
      }
    }

    function connect() {
      if (connectingRef.current || !mountedRef.current) return;
      connectingRef.current = true;

      const idx = urlIndexRef.current % XRPL_URLS.length;
      const url = XRPL_URLS[idx];
      setActiveNode(getHostname(idx));

      const ws = new WebSocket(url);
      wsRef.current = ws;

      const timeout = setTimeout(() => {
        connectingRef.current = false;
        ws.close();
        // onclose will also fire — guard prevents double reconnect
      }, CONNECT_TIMEOUT);

      ws.onopen = () => {
        clearTimeout(timeout);
        const isPrimary = url === XRPL_URLS[0];
        connectingRef.current = false;
        reconnectDelayRef.current = 1_000;
        urlIndexRef.current = 0; // reset so next failover retries primary first
        lastErrorLogRef.current = null; // reset so next failure is logged
        setConnected(true);
        console.log(`[XRPL-Client] Connected to ${url}${isPrimary ? "" : " (fallback)"}`);
        if (isPrimary) {
          stopPrimaryProbe();
        } else {
          startPrimaryProbe();
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.id !== undefined) {
            const cb = pendingRef.current.get(data.id);
            if (cb) {
              pendingRef.current.delete(data.id);
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
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        connectingRef.current = false;
        setConnected(false);
        rejectAllPending("WebSocket connection closed");
        wsRef.current = null;
        if (switchingToPrimaryRef.current) {
          switchingToPrimaryRef.current = false;
          reconnectDelayRef.current = 1_000;
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          connect();
        } else {
          rotateAndReconnect();
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        connectingRef.current = false;
        setConnected(false);
        rejectAllPending("WebSocket error");
        // Log only once per URL to avoid console spam during extended outages
        if (lastErrorLogRef.current !== url) {
          console.error(`[XRPL-Client] Connection failed: ${url}`);
          lastErrorLogRef.current = url;
        }
        // onclose will fire after onerror, which handles reconnection
      };
    }

    function rotateAndReconnect() {
      if (!mountedRef.current) return;
      urlIndexRef.current++;
      const delay = reconnectDelayRef.current;
      const jitter = Math.random() * Math.min(delay * 0.3, 2_000);
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay + jitter);
    }

    function startPrimaryProbe() {
      stopPrimaryProbe();
      if (!mountedRef.current) return;
      primaryProbeTimerRef.current = setTimeout(() => {
        primaryProbeTimerRef.current = null;
        if (!mountedRef.current) return;

        const primaryUrl = XRPL_URLS[0];
        let settled = false;
        const probe = new WebSocket(primaryUrl);

        const probeTimeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { probe.close(); } catch { /* ignore */ }
          startPrimaryProbe(); // retry later
        }, CONNECT_TIMEOUT);

        probe.onopen = () => {
          if (settled) return;
          settled = true;
          clearTimeout(probeTimeout);
          try { probe.close(); } catch { /* ignore */ }
          console.log("[XRPL-Client] Primary recovered, switching back");
          switchingToPrimaryRef.current = true;
          urlIndexRef.current = 0;
          wsRef.current?.close(); // close handler will reconnect to primary
        };

        probe.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(probeTimeout);
          startPrimaryProbe(); // retry later
        };
      }, PRIMARY_PROBE_INTERVAL);
    }

    connect();

    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
      stopPrimaryProbe();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      rejectAllPending("Component unmounted");
    };
  }, []);

  /* ---- send ------------------------------------------------------- */

  const send = useCallback(
    (command: Record<string, unknown>): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error("WebSocket not connected"));
          return;
        }

        const id = requestIdRef.current = (requestIdRef.current + 1) % 2_000_000_000;
        pendingRef.current.set(id, { resolve, reject });

        try {
          ws.send(JSON.stringify({ ...command, id }));
        } catch (err) {
          pendingRef.current.delete(id);
          reject(err);
          return;
        }

        setTimeout(() => {
          if (pendingRef.current.has(id)) {
            pendingRef.current.delete(id);
            reject(new Error("Request timed out"));
          }
        }, REQUEST_TIMEOUT);
      });
    },
    []
  );

  /* ---- context value ---------------------------------------------- */

  const contextValue = useMemo(() => ({ send, connected, activeNode }), [send, connected, activeNode]);

  return (
    <XrplContext.Provider value={contextValue}>{children}</XrplContext.Provider>
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
