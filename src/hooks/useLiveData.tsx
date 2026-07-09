"use client";

/**
 * LiveDataProvider + useLiveData hook
 *
 * A single EventSource connection per browser tab.  The provider sits in the
 * root layout and broadcasts named SSE events into React context.  Any
 * component can call `useLiveData()` to read the latest live values.
 *
 * The hook returns `null` for each data slice until the first event of that
 * type arrives, so components should fall back to their server-rendered
 * `initial*` props.
 *
 * **SSE gating.** The connection is only opened on routes that actually
 * consume live data (home, network, nft list, account pages — see
 * `SSE_ROUTES`). Token, intel, portfolio, smart-money, etc. pages get
 * the empty-context fallback; consumers there see `connected: false`
 * and rely on their server-rendered initial props. Saves an open SSE
 * stream per visit on the long tail of routes that never read it.
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
import { usePathname } from "next/navigation";
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
import type { RecentMint } from "@/lib/xrpl-data";

/* ------------------------------------------------------------------ */
/*  Context shape                                                      */
/* ------------------------------------------------------------------ */

const MAX_LEDGER_HISTORY = 201; // 201 events = 200 intervals for heatmap grid

export interface LiveData {
  ledger: LedgerEvent | null;
  /** Rolling history of the last ~35 ledger events (newest last). */
  ledgerHistory: LedgerEvent[];
  transactions: RecentTx[] | null;
  txCount: number | null;
  stats: NetworkStats | null;
  fee: FeeInfo | null;
  health: ServerHealth | null;
  txDistribution: TxTypeDistribution[] | null;
  price: PriceData | null;
  /** Rolling buffer of the 4 most recent NFTokenMint transactions */
  recentMints: RecentMint[] | null;
  connected: boolean;
}

const initial: LiveData = {
  ledger: null,
  ledgerHistory: [],
  transactions: null,
  txCount: null,
  stats: null,
  fee: null,
  health: null,
  txDistribution: null,
  price: null,
  recentMints: null,
  connected: false,
};

const LiveDataContext = createContext<LiveData>(initial);

function safeParse<T>(data: string, label: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    console.warn(`[live-data] Failed to parse ${label} event`);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

// Routes that mount a `useLiveData()` consumer. Anything outside this
// set skips the SSE connection entirely. Update when adding a new
// consumer in a route family that isn't already covered.
const SSE_ROUTE_PATTERN = /^\/(?:$|network$|nft(?:\/|$)|account(?:\/|$))/;

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LiveData>(initial);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const pathname = usePathname() ?? "/";
  const shouldConnect = useMemo(
    () => SSE_ROUTE_PATTERN.test(pathname),
    [pathname],
  );

  useEffect(() => {
    // Reset on re-mount (React strict mode unmounts then re-mounts)
    mountedRef.current = true;

    if (!shouldConnect) {
      // Navigated to a route with no live-data consumers — tear down
      // any active connection so the server stream can close.
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
        setData((prev) => ({ ...prev, connected: false }));
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      return () => {
        mountedRef.current = false;
      };
    }

    function connect() {
      // Don't double-connect
      if (esRef.current) return;

      const es = new EventSource("/api/stream");
      esRef.current = es;

      es.onopen = () => {
        setData((prev) => ({ ...prev, connected: true }));
      };

      es.onerror = () => {
        setData((prev) => ({ ...prev, connected: false }));
        es.close();
        esRef.current = null;
        // Clear any pending reconnect timer to avoid stacking
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
        // Reconnect after 3 s if still mounted
        if (mountedRef.current) {
          reconnectTimer.current = setTimeout(() => connect(), 3_000);
        }
      };

      /* Named event listeners — one per data slice */

      es.addEventListener("ledger", (e) => {
        const parsed = safeParse<LedgerEvent>(e.data, "ledger");
        if (!parsed) return;
        setData((prev) => {
          // Deduplicate
          if (prev.ledger?.ledger_index === parsed.ledger_index) return prev;
          const history = [...prev.ledgerHistory, parsed].slice(
            -MAX_LEDGER_HISTORY
          );
          return { ...prev, ledger: parsed, ledgerHistory: history };
        });
      });

      es.addEventListener("transactions", (e) => {
        const parsed = safeParse<{ txs: RecentTx[]; total: number }>(
          e.data,
          "transactions"
        );
        if (!parsed) return;
        setData((prev) => ({
          ...prev,
          transactions: parsed.txs,
          txCount: parsed.total,
        }));
      });

      es.addEventListener("stats", (e) => {
        const parsed = safeParse<NetworkStats>(e.data, "stats");
        if (!parsed) return;
        setData((prev) => ({ ...prev, stats: parsed }));
      });

      es.addEventListener("fee", (e) => {
        const parsed = safeParse<FeeInfo>(e.data, "fee");
        if (!parsed) return;
        setData((prev) => ({ ...prev, fee: parsed }));
      });

      es.addEventListener("health", (e) => {
        const parsed = safeParse<ServerHealth>(e.data, "health");
        if (!parsed) return;
        setData((prev) => ({ ...prev, health: parsed }));
      });

      es.addEventListener("txDistribution", (e) => {
        const parsed = safeParse<TxTypeDistribution[]>(
          e.data,
          "txDistribution"
        );
        if (!parsed) return;
        setData((prev) => ({ ...prev, txDistribution: parsed }));
      });

      es.addEventListener("price", (e) => {
        const parsed = safeParse<PriceData>(e.data, "price");
        if (!parsed) return;
        setData((prev) => ({ ...prev, price: parsed }));
      });

      es.addEventListener("recentMints", (e) => {
        const parsed = safeParse<RecentMint[]>(e.data, "recentMints");
        if (!parsed) return;
        setData((prev) => ({ ...prev, recentMints: parsed }));
      });
    }

    connect();

    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
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
