import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAccountTxPage, type AccountTx, type AccountTxPage } from "@/lib/account-tx";
import { isAbortError } from "@/lib/xrpl-errors";
import { useXrpl } from "./useXrplWs";
import { ACCOUNT_DATA_MAX_AGE_MS, useXrplQuery } from "./useXrplQuery";

interface Extra {
  /** The first page these older pages continue. A new first page
   *  (another account, a retry) orphans them. */
  base: AccountTxPage;
  items: AccountTx[];
  /** Older pages loaded after the first. */
  pages: number;
  marker?: unknown;
  failed: boolean;
}

/**
 * Account history over `account_tx`, newest first. The first page is
 * cached by SWR; `loadMore` follows the marker one page at a time and is
 * aborted on unmount or when the address changes.
 */
export function useAccountTx(address: string) {
  const { send } = useXrpl();
  const {
    data: first,
    error,
    isLoading,
    retry,
  } = useXrplQuery<AccountTxPage>(
    address ? ["account-tx", address] : null,
    ({ send: bound }) => fetchAccountTxPage(bound, address),
    { maxAgeMs: ACCOUNT_DATA_MAX_AGE_MS },
  );
  const [extra, setExtra] = useState<Extra | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      inFlight.current?.abort();
      inFlight.current = null;
    },
    [address],
  );

  const own = first && extra?.base === first ? extra : null;
  const marker = own ? own.marker : first?.marker;
  const items = useMemo(
    () => (first ? (own ? [...first.items, ...own.items] : first.items) : []),
    [first, own],
  );

  const loadMore = useCallback(async () => {
    if (!first || marker === undefined || loadingMore) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const { signal } = controller;
    setLoadingMore(true);
    try {
      const page = await fetchAccountTxPage((cmd, opts) => send(cmd, { ...opts, signal }), address, marker);
      if (signal.aborted) return;
      setExtra((prev) => {
        const kept = prev?.base === first ? prev : null;
        return {
          base: first,
          items: [...(kept?.items ?? []), ...page.items],
          pages: (kept?.pages ?? 0) + 1,
          marker: page.marker,
          failed: false,
        };
      });
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return;
      setExtra((prev) =>
        prev?.base === first
          ? { ...prev, failed: true }
          : { base: first, items: [], pages: 0, marker, failed: true },
      );
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setLoadingMore(false);
    }
  }, [first, marker, loadingMore, send, address]);

  const retryMore = useCallback(
    () => setExtra((prev) => (prev ? { ...prev, failed: false } : prev)),
    [],
  );

  return {
    items,
    /** `account_tx` pages loaded so far (50 rows each). */
    pagesLoaded: first ? 1 + (own?.pages ?? 0) : 0,
    /** No first page yet (connecting, fetching or retrying). */
    loading: isLoading,
    failed: !first && !isLoading && !!error,
    hasMore: marker !== undefined && !own?.failed,
    loadMore,
    loadingMore,
    moreFailed: !!own?.failed,
    retry,
    retryMore,
  };
}
