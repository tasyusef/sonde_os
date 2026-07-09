"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { mutate as globalMutate } from "swr";
import { CACHE_KEYS } from "@/lib/swr-config";

/**
 * Portfolio-wide refresh state.
 *
 * On mount, posts to `/api/portfolio/refresh` which:
 *   1. Reconciles CH `trustlines` against live rippled `account_lines`
 *      for the signed-in user (heals phantom holdings).
 *   2. Writes a fresh `portfolio_snapshots` row off the reconciled
 *      state.
 *
 * After the POST resolves we `mutate` all portfolio SWR keys that
 * derive from the snapshot. All consuming panels (TokensPanel,
 * AllocationChart, PnLWaterfall, etc.) revalidate and re-render with
 * the freshly-written data.
 *
 * `isRefreshing` is exposed via context so panels can show a 3-dot
 * "Refreshing live balances…" indicator that mirrors the account-page
 * pattern. One refresh fires per portfolio dashboard mount — panels
 * sharing the context all see the same flag.
 *
 * Failure modes are silent: a flaky rippled, rate-limit hit (5/min
 * per session), or auth expiry all just leave the SWR data as-is
 * (last-snapshot-served). No error UI surfaces — the user still gets
 * data, just not freshly reconciled.
 */
interface PortfolioRefreshContextValue {
  isRefreshing: boolean;
}

const PortfolioRefreshContext = createContext<PortfolioRefreshContextValue>({
  isRefreshing: false,
});

export function usePortfolioRefresh(): PortfolioRefreshContextValue {
  return useContext(PortfolioRefreshContext);
}

export default function PortfolioRefreshProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function reconcile() {
      setIsRefreshing(true);
      try {
        const res = await fetch("/api/portfolio/refresh", { method: "POST" });
        if (cancelled) return;
        // Only revalidate on success — a 429/502 means we'd be
        // re-fetching the same stale data; let the user manually
        // refresh if they want to retry.
        if (res.ok) {
          // Mutate all portfolio endpoints that depend on the snapshot.
          // SWR fans out to every hook subscribed to these keys.
          await Promise.all([
            globalMutate(CACHE_KEYS.portfolioTokens()),
            globalMutate(CACHE_KEYS.portfolioCurrent()),
            globalMutate(CACHE_KEYS.portfolioAmm()),
          ]);
        }
      } catch {
        // Silent fall-through — SWR data stays. The user sees the
        // last snapshot. Manual reload retries.
      } finally {
        if (!cancelled) setIsRefreshing(false);
      }
    }

    void reconcile();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PortfolioRefreshContext.Provider value={{ isRefreshing }}>
      {children}
    </PortfolioRefreshContext.Provider>
  );
}
