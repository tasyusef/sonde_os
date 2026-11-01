/**
 * LiveDataProvider + useLiveData hook
 *
 * One live connection per browser tab: a WebSocket to the Cloudflare relay
 * in `relay/` (`VITE_LIVE_RELAY_URL`), which sends one compact
 * snapshot per ledger close. Without the URL nothing connects and every
 * slice stays `null`. Tabs hidden for a while disconnect, so they don't
 * keep downloading.
 *
 * The hook returns `null` for each data slice until it first arrives.
 *
 * **Route gating.** The connection is only opened on routes that actually
 * consume live data (network and account pages — see `LIVE_ROUTE_PATTERN`).
 * Other pages get the empty-context fallback; consumers there see
 * `connected: false`.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";
import {
  applySnapshot,
  initialLiveData,
  type LiveData,
  type RelaySnapshot,
} from "@/lib/live-snapshot";

export type { LiveData };

const LiveDataContext = createContext<LiveData>(initialLiveData);

const RELAY_URL = import.meta.env.VITE_LIVE_RELAY_URL;
const RECONNECT_MS = 3_000;
/** No snapshot this long means the relay or its node connection stalled. */
const RELAY_STALE_MS = 20_000;
/** A tab hidden this long disconnects from the relay until it's shown again. */
const HIDDEN_DISCONNECT_MS = 30_000;

function safeParse<T>(data: string, label: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    console.warn(`[live-data] Failed to parse ${label} event`); // audit-ok
    return null;
  }
}

// Routes that mount a `useLiveData()` consumer (network page; account
// pages read price and reserves). Anything outside this set skips the
// live connection entirely. Update when adding a new consumer in a
// route family that isn't already covered.
const LIVE_ROUTE_PATTERN = /^\/(?:network$|account\/)/;

type Setter = (update: (prev: LiveData) => LiveData) => void;

/** Opens the relay socket. Calls `onClosed` when it drops on its own; the
 *  returned function closes it without triggering `onClosed`. */
type Transport = (setData: Setter, onClosed: () => void) => () => void;

const relayTransport =
  (url: string): Transport =>
  (setData, onClosed) => {
    const ws = new WebSocket(url);
    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByUs = false;
    const armStaleTimer = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => ws.close(), RELAY_STALE_MS);
    };

    ws.onopen = () => {
      setData((prev) => ({ ...prev, connected: true }));
      armStaleTimer();
    };
    ws.onmessage = (e) => {
      const snapshot = safeParse<RelaySnapshot>(String(e.data), "relay snapshot");
      if (!snapshot) return;
      armStaleTimer();
      setData((prev) => applySnapshot(prev, snapshot));
    };
    ws.onclose = () => {
      if (staleTimer) clearTimeout(staleTimer);
      setData((prev) => ({ ...prev, connected: false }));
      if (!closedByUs) onClosed();
    };

    return () => {
      closedByUs = true;
      ws.close();
    };
  };

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LiveData>(initialLiveData);
  const closeRef = useRef<(() => void) | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const { pathname } = useLocation();
  const shouldConnect = useMemo(
    () => !!RELAY_URL && LIVE_ROUTE_PATTERN.test(pathname),
    [pathname],
  );

  useEffect(() => {
    // Reset on re-mount (React strict mode unmounts then re-mounts)
    mountedRef.current = true;

    const clearTimer = (timer: typeof reconnectTimer) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const disconnect = () => {
      closeRef.current?.();
      closeRef.current = null;
      clearTimer(reconnectTimer);
      setData((prev) => (prev.connected ? { ...prev, connected: false } : prev));
    };

    if (!shouldConnect) {
      // Navigated to a route with no live-data consumers — tear down
      // any active connection.
      disconnect();
      return () => {
        mountedRef.current = false;
      };
    }

    function connect() {
      // Don't double-connect
      if (closeRef.current || !RELAY_URL) return;
      closeRef.current = relayTransport(RELAY_URL)(setData, () => {
        closeRef.current = null;
        clearTimer(reconnectTimer);
        // Reconnect after 3 s if still mounted and visible
        if (mountedRef.current && !document.hidden) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_MS);
        }
      });
    }

    // Hidden tabs stop downloading after a grace period.
    const onVisibilityChange = () => {
      clearTimer(hiddenTimer);
      if (document.hidden) {
        hiddenTimer.current = setTimeout(disconnect, HIDDEN_DISCONNECT_MS);
      } else {
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimer(hiddenTimer);
      disconnect();
    };
  }, [shouldConnect]);

  return (
    <LiveDataContext.Provider value={data}>{children}</LiveDataContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useLiveData(): LiveData {
  return useContext(LiveDataContext);
}
