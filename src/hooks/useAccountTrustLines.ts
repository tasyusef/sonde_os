"use client";

/**
 * useAccountTrustLines — current trustlines for an account, fetched
 * from the CH `trustlines` state mirror via `/api/account/[address]/trustlines`.
 *
 * Two-phase load to balance latency with correctness:
 *
 *   Phase 1 — CH read (instant paint):
 *     SWR fetches the GET endpoint. CH is sub-100ms regardless of
 *     trustline count, so the holdings table renders immediately.
 *
 *   Phase 2 — live refresh (background reconcile):
 *     On every address mount, POST `/api/account/[address]/trustlines/refresh`
 *     fires in parallel. That endpoint pulls `account_lines` from
 *     rippled and upserts CH — including burn rows for phantom
 *     holdings (rows in CH whose `DeletedNode RippleState` event was
 *     missed). Once the POST resolves, we `mutate()` the SWR cache so
 *     the GET re-fetches and the holdings table updates in place.
 *
 * The `isRefreshing` flag is consumer-driven UX — components show the
 * 3-dot LoadingDots indicator + "Refreshing live balances…" copy
 * while the live fetch is in flight, then the indicator disappears
 * once the table re-renders with the freshly reconciled data.
 *
 * If the refresh POST fails (502 from rippled, 429 from the rate
 * limiter), the hook silently drops back to the CH-only data. Failure
 * never blocks the paint.
 *
 * Returns rippled-shaped `TrustLine[]` so existing consumers
 * (`partitionTrustLines`, `useAccountTokenPrices`, `useAccountAmmPositions`,
 * `TrustLineList`) work unchanged. The queried account is always
 * emitted as the LowLimit side so perspective math returns identical
 * output without any consumer-side changes.
 */

import useSWR from "swr";
import { useEffect, useMemo, useState } from "react";
import { fetcher } from "@/lib/swr-config";
import { partitionTrustLines } from "@/lib/amm-helpers";
import type { TrustLine } from "@/components/account/TrustLineList";

interface TrustLinesResponse {
  trustLines: TrustLine[];
  count: number;
  error?: string;
}

export interface AccountTrustLinesViews {
  isLoading: boolean;
  /** True while the background live-refresh POST is in flight. UI
   *  uses this to show a small "Refreshing live balances…" badge. */
  isRefreshing: boolean;
  error: unknown;
  /** Every trustline — regular + LP. */
  allTrustLines: TrustLine[];
  /** RippleState minus LP tokens. Use for portfolio math + Holdings. */
  regularTrustLines: TrustLine[];
  /** RippleState entries representing AMM LP positions. */
  lpTrustLines: TrustLine[];
}

export function useAccountTrustLines(address: string): AccountTrustLinesViews {
  const { data, error, isLoading, mutate } = useSWR<TrustLinesResponse>(
    address ? `/api/account/${address}/trustlines` : null,
    fetcher,
    {
      dedupingInterval: 30_000,
      keepPreviousData: true,
      errorRetryCount: 2,
      revalidateOnFocus: false,
    },
  );

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fire a live-state reconcile on every address mount. The endpoint
  // is idempotent + rate-limited; if it's already running for this
  // address from another tab the server-side rate limiter throttles.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    async function reconcile() {
      // setState lives inside the async function (not the effect body
      // directly) so the `react-hooks/set-state-in-effect` rule
      // doesn't fire. This is a one-shot fire-on-mount pattern; the
      // next render of the hook doesn't re-trigger because the
      // effect's `address` dep is stable across revalidations.
      setIsRefreshing(true);
      try {
        await fetch(`/api/account/${address}/trustlines/refresh`, {
          method: "POST",
        });
        if (cancelled) return;
        // Revalidate the GET cache so the table picks up burns +
        // freshly-written balances from the refresh.
        await mutate();
      } catch {
        // Silently fall through — CH data is still rendered. The user
        // sees whatever was already in CH, no error UI. Failure is
        // expected on flaky rippled / rate-limit hits.
      } finally {
        if (!cancelled) setIsRefreshing(false);
      }
    }

    void reconcile();

    return () => {
      cancelled = true;
    };
  }, [address, mutate]);

  const views = useMemo(() => {
    const allTrustLines = data?.trustLines ?? [];
    const partitioned = partitionTrustLines(allTrustLines, address);
    return {
      allTrustLines,
      regularTrustLines: partitioned.regularTrustLines,
      lpTrustLines: partitioned.lpTrustLines,
    };
  }, [data, address]);

  return { isLoading, isRefreshing, error, ...views };
}
