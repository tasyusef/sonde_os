"use client";

/**
 * TransactionsTab — wrapper for the account-page transactions tab. Owns:
 *
 *   - the date-range chip strip + custom date inputs
 *   - URL sync (`?range=` / `?from=&to=`) via `window.history.replaceState`
 *     so chip clicks don't trigger a full server round-trip
 *   - cursor-paginated tx fetching from `/api/account/[address]/
 *     transactions`, scoped to the active filter
 *
 * On first mount, when the active filter matches whatever the server
 * rendered with, we use the SSR-provided initial items + cursor instead
 * of refetching. After that, every chip change triggers a fresh fetch.
 *
 * The hook intentionally lives separately from `useAccountData` — the
 * latter feeds NFT burn detection and activations from a lifetime-style
 * initial window, while this tab needs filtered slices that change as
 * the user clicks chips. Sharing one cursor would couple two
 * orthogonal concerns.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateRangeChips, {
  type ChipValue,
} from "@/components/account/DateRangeChips";
import TransactionList from "@/components/account/TransactionList";
import LoadingDots from "@/components/shared/LoadingDots";
import { useAccountCounts } from "@/hooks/useAccountCounts";
import { DEFAULT_RANGE } from "@/lib/account-tx-range";
import type {
  AccountTxCursor,
  InitialAccountHistory,
} from "@/hooks/useAccountData";
import type { AccountTxResult } from "@/types/xrpl";

interface Props {
  address: string;
  filterDestinationTag?: number | null;
  /** Server-rendered initial slice for this filter. When the filter
   *  matches the server's render, the first paint uses these items
   *  without a refetch round-trip. */
  initialHistory?: InitialAccountHistory | null;
  /** The chip value the server resolved from URL params on render. The
   *  client mounts with the same value to avoid a hydration mismatch and
   *  uses it as the "no refetch needed" anchor. */
  initialChipValue: ChipValue;
  initialCustomFrom: string;
  initialCustomTo: string;
}

interface TxFetchResult {
  items: AccountTxResult["transactions"];
  nextCursor: AccountTxCursor | null;
}

export default function TransactionsTab({
  address,
  filterDestinationTag,
  initialHistory,
  initialChipValue,
  initialCustomFrom,
  initialCustomTo,
}: Props) {
  const [chipValue, setChipValue] = useState<ChipValue>(initialChipValue);
  const [customFrom, setCustomFrom] = useState(initialCustomFrom);
  const [customTo, setCustomTo] = useState(initialCustomTo);

  // Filter key — refetch is keyed on this. For "custom" without both
  // dates, the key is null so the effect skips (the chip strip will
  // seed default dates on its own).
  const filterKey = useMemo(() => {
    if (chipValue === "custom") {
      if (!customFrom || !customTo) return null;
      return `custom:${customFrom}:${customTo}`;
    }
    return `range:${chipValue}`;
  }, [chipValue, customFrom, customTo]);

  // Page state is bundled with the filterKey it was fetched for. That
  // lets `loading` derive from a comparison rather than a synchronous
  // setLoading() inside the fetch effect — keeps React's
  // set-state-in-effect rule happy and avoids cascading renders.
  const initialKey = filterKey ?? `initial:${chipValue}`;
  const [pageState, setPageState] = useState<{
    key: string;
    items: AccountTxResult["transactions"];
    cursor: AccountTxCursor | null;
  }>({
    key: initialKey,
    items: initialHistory?.transactions ?? [],
    cursor: initialHistory?.nextCursor ?? null,
  });
  const [loadingMore, setLoadingMore] = useState(false);

  // Skip the first effect run ONLY when the server actually rendered
  // initial items for the active filter. Post-perf-refactor (commit
  // 03fdc05) the account page passes initialHistory=null to keep TTFB
  // under 500ms on heavy accounts — so for those mounts we DO want to
  // fetch on the first effect run, otherwise the table sits empty
  // until the user clicks a chip.
  const hasInitialServerData =
    initialHistory != null && initialHistory.transactions.length > 0;
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      // Server provided data for this filter — skip the fetch (it'd be
      // a duplicate of what's already on screen).
      if (hasInitialServerData) return;
      // No SSR data — fall through to the fetch below.
    }
    if (filterKey == null) {
      // "custom" picked but dates not yet valid — hold previous slice
      // visible; don't blank the table while the user fills inputs.
      return;
    }
    if (filterKey === pageState.key) return;

    let cancelled = false;
    fetchPage(address, chipValue, customFrom, customTo, null)
      .then((res) => {
        if (cancelled) return;
        setPageState({ key: filterKey, items: res.items, cursor: res.nextCursor });
      })
      .catch(() => {
        if (cancelled) return;
        setPageState({ key: filterKey, items: [], cursor: null });
      });
    return () => {
      cancelled = true;
    };
  }, [
    filterKey,
    address,
    chipValue,
    customFrom,
    customTo,
    pageState.key,
    hasInitialServerData,
  ]);

  // Loading is derived: a fetch is in flight whenever the active
  // filterKey doesn't match the last successfully-applied page key. No
  // setLoading() call needed.
  const loading = filterKey != null && filterKey !== pageState.key;

  // URL sync — write the active filter back to the URL via
  // `replaceState` so back-button + share-links work without forcing a
  // full server-side rerender on every chip click. We only emit
  // non-default state, keeping URLs clean.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("range");
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    if (chipValue === "custom") {
      if (customFrom && customTo) {
        url.searchParams.set("from", customFrom);
        url.searchParams.set("to", customTo);
      }
    } else if (chipValue !== DEFAULT_RANGE) {
      url.searchParams.set("range", chipValue);
    }
    window.history.replaceState(null, "", url.toString());
  }, [chipValue, customFrom, customTo]);

  const handleChipChange = useCallback(
    (next: { value: ChipValue; from?: string; to?: string }) => {
      setChipValue(next.value);
      if (next.value === "custom") {
        if (next.from !== undefined) setCustomFrom(next.from);
        if (next.to !== undefined) setCustomTo(next.to);
      }
    },
    [],
  );

  const handleLoadMore = useCallback(async () => {
    if (!pageState.cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchPage(
        address,
        chipValue,
        customFrom,
        customTo,
        pageState.cursor,
      );
      setPageState((prev) =>
        // Discard the response if the filter has changed mid-flight —
        // the next chip click already kicked off a fresh top-of-list
        // fetch and we don't want to splice older paginated results
        // onto a newer filter's data.
        prev.key !== pageState.key
          ? prev
          : {
              key: prev.key,
              items: [...prev.items, ...res.items],
              cursor: res.nextCursor,
            },
      );
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }, [
    address,
    chipValue,
    customFrom,
    customTo,
    pageState.cursor,
    pageState.key,
    loadingMore,
  ]);

  return (
    <div className="space-y-3">
      <DateRangeChips
        value={chipValue}
        customFrom={customFrom}
        customTo={customTo}
        onChange={handleChipChange}
      />
      <TxStatusRow
        visibleCount={pageState.items.length}
        loading={loading}
        loadingMore={loadingMore}
        address={address}
        hasMore={pageState.cursor != null}
        chipValue={chipValue}
      />
      <TransactionList
        transactions={pageState.items}
        address={address}
        filterDestinationTag={filterDestinationTag}
        hasMore={pageState.cursor != null}
        onLoadMore={handleLoadMore}
        loadingMore={loading || loadingMore}
      />
    </div>
  );
}

/** Status line between the date chips and the table. Shows
 *  "{Loading|Showing} {visible} of {total} transactions" with the
 *  bouncing-dots indicator when a fetch is in flight, plus an honesty
 *  hint when our CH retention can't cover the account's full history.
 *
 *  - Initial load (no items yet, fetch active): "Loading transactions…"
 *  - Loading more / chip change: "Loading {visible} of {total}…"
 *  - Idle, fully served: "Showing {visible} of {total} transactions"
 *  - Idle, range-filtered: total denominator stands; chips above set
 *    the user-readable filter context, no extra string needed.
 *  - Idle, retention-gap: "Showing {visible} of {total} transactions —
 *    older history (pre-{Month YYYY}) not indexed" — fires when the
 *    user's lifetime first activity predates our CH retention window
 *    AND the API has no more pages to serve. Distinguishes "filter
 *    excludes the rest" from "we never had it" so users don't read the
 *    gap as a bug.
 *
 *  `total` is the lifetime tx count from PG counters; `indexMinLedger`
 *  / `indexMinTimestamp` come from the same counts response and are
 *  cluster-wide constants (cached server-side for 1h). */
function TxStatusRow({
  visibleCount,
  loading,
  loadingMore,
  address,
  hasMore,
  chipValue,
}: {
  visibleCount: number;
  loading: boolean;
  loadingMore: boolean;
  address: string;
  hasMore: boolean;
  chipValue: ChipValue;
}) {
  const { counts } = useAccountCounts(address);
  const totalCount = counts?.totalCount ?? 0;
  const isFetching = loading || loadingMore;
  const isExhausted = !isFetching && !hasMore;

  // Surface the retention gap when:
  //   1. We've shown everything CH can serve for the active filter, and
  //   2. The lifetime count from PG exceeds what we showed, and
  //   3. The account's first activity precedes our index window, and
  //   4. The user is on an unbounded date filter — otherwise the
  //      shortfall is just the active range filter doing its job, and
  //      the chips above already explain that.
  const hasUnindexedHistory =
    isExhausted &&
    totalCount > visibleCount &&
    counts?.firstSeenLedger != null &&
    counts?.indexMinLedger != null &&
    counts.firstSeenLedger < counts.indexMinLedger &&
    chipValue === "all";

  const cutoffLabel =
    hasUnindexedHistory && counts?.indexMinTimestamp
      ? formatMonthYear(counts.indexMinTimestamp)
      : null;

  const copy = useMemo(() => {
    const visible = visibleCount.toLocaleString();
    const total = totalCount.toLocaleString();
    if (isFetching && visibleCount === 0) {
      return totalCount > 0
        ? `Loading transactions (of ${total})`
        : "Loading transactions";
    }
    if (isFetching) {
      return totalCount > 0
        ? `Loading ${visible} of ${total} transactions`
        : `Loading ${visible} transactions`;
    }
    if (hasUnindexedHistory && cutoffLabel) {
      return `Showing ${visible} of ${total} transactions — older history (pre-${cutoffLabel}) not indexed`;
    }
    return totalCount > 0
      ? `Showing ${visible} of ${total} transactions`
      : `Showing ${visible} transactions`;
  }, [visibleCount, totalCount, isFetching, hasUnindexedHistory, cutoffLabel]);

  return (
    <div
      className="flex min-h-5 items-center gap-2 px-1 font-mono text-tag text-muted"
      role="status"
      aria-live="polite"
    >
      {isFetching && <LoadingDots className="text-brand" />}
      <span>{copy}</span>
    </div>
  );
}

/** "2025-05-01 00:00:00" → "May 2025". Returns the input unchanged on
 *  parse failure so we don't ship a half-broken hint. */
function formatMonthYear(chTimestamp: string): string {
  const ms = Date.parse(`${chTimestamp.replace(" ", "T")}Z`);
  if (!Number.isFinite(ms)) return chTimestamp;
  const d = new Date(ms);
  return d.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function fetchPage(
  address: string,
  chip: ChipValue,
  customFrom: string,
  customTo: string,
  cursor: AccountTxCursor | null,
): Promise<TxFetchResult> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) {
    params.set("before_ts", cursor.timestamp);
    params.set("before_hash", cursor.txHash);
  }
  if (chip === "custom") {
    if (customFrom && customTo) {
      params.set("from", customFrom);
      params.set("to", customTo);
    }
  } else {
    params.set("range", chip);
  }
  const url = `/api/account/${encodeURIComponent(address)}/transactions?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const json = (await res.json()) as TxFetchResult;
  return {
    items: json.items ?? [],
    nextCursor: json.nextCursor ?? null,
  };
}

