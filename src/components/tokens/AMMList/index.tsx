"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { AMMListItem, AMMListPage } from "@/lib/amm-data";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import AMMTable from "@/components/tokens/AMMTable";
import Pagination from "@/components/shared/Pagination";

/** Server fetch chunk size — fixed because the API page is a single
 *  PG round-trip and 100 rows is the cheapest natural unit. The user-
 *  facing `pageSize` is independent (chosen from PAGE_SIZE_OPTIONS). */
const SERVER_PAGE_SIZE = 100;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type SortField = "tvl" | "fee";
export type SortDir = "asc" | "desc";

function getSortValue(p: AMMListItem, field: SortField): number {
  return field === "tvl" ? p.tvlXrp : p.tradingFee;
}

function filterPools(pools: AMMListItem[], q: string): AMMListItem[] {
  if (!q) return pools;
  const needle = q.toLowerCase();
  return pools.filter(
    (p) =>
      p.currencyDisplay.toLowerCase().includes(needle) ||
      p.currency.toLowerCase().includes(needle) ||
      p.issuerName?.toLowerCase().includes(needle) ||
      p.issuer.toLowerCase().includes(needle) ||
      p.account.toLowerCase().includes(needle),
  );
}

/**
 * AMM listing for the /markets AMMs tab. Owns filter + sort + paginate
 * state, paints the card surface + header bar + filter input, and
 * delegates row rendering to `<AMMTable>`. Pagination footer is the
 * shared `<Pagination>` component — same UX as the account-page
 * transaction list (page-size select, prev/next chevrons, range
 * label), with transparent server-side backfill when the user
 * advances past loaded data.
 *
 * The data layer caps the universe at 1000 pools; beyond that
 * `hasMore` flips false and Next disables on its own.
 *
 * Filter is local against loaded rows (same as TokenSearch). When
 * filtered, pagination is constrained to filter matches and the
 * transparent backfill is disabled — tight filters could otherwise
 * trigger a wasteful series of "no matches in next batch" fetches.
 */
export default function AMMList({
  initialPools,
  initialTotal,
  initialHasMore,
}: {
  initialPools: AMMListItem[];
  initialTotal: number;
  initialHasMore: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("tvl");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [pageSize, setPageSize] = useState<PageSize>(100);
  const [pageIndex, setPageIndex] = useState(0);

  // Page 0 served via SWR with SSR fallback — matches the Tokens pattern.
  const { data: page0 } = useSWR<AMMListPage>(
    CACHE_KEYS.ammList(0, SERVER_PAGE_SIZE),
    fetcher,
    {
      fallbackData: {
        pools: initialPools,
        total: initialTotal,
        hasMore: initialHasMore,
      },
    },
  );

  const [extraPages, setExtraPages] = useState<AMMListItem[]>([]);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  const allPools = useMemo(() => {
    const base = page0?.pools ?? initialPools;
    return [...base, ...extraPages];
  }, [page0?.pools, initialPools, extraPages]);

  const total = page0?.total ?? initialTotal;

  // Filter THEN sort — same order as TokenSearch so toggling the sort
  // doesn't undo the filter and vice-versa.
  const sortedFiltered = useMemo(() => {
    const sign = sortDir === "desc" ? -1 : 1;
    return filterPools(allPools, filter).toSorted(
      (a, b) => (getSortValue(a, sortField) - getSortValue(b, sortField)) * sign,
    );
  }, [allPools, filter, sortField, sortDir]);

  // Reset page index whenever the filter changes — React explicitly
  // supports this mid-render setState pattern when comparing to a
  // stored-previous value (the runtime short-circuits the render to
  // re-run with the fresh state before committing).
  const [prevFilter, setPrevFilter] = useState(filter);
  if (prevFilter !== filter) {
    setPrevFilter(filter);
    setPageIndex(0);
  }

  const visibleStart = pageIndex * pageSize;
  const visibleEnd = visibleStart + pageSize;
  const visible = sortedFiltered.slice(visibleStart, visibleEnd);

  // Transparent backfill — fire a next-chunk fetch when the user
  // advances past loaded rows. Only when filter is inactive; a tight
  // filter could otherwise loop a chain of "no matches in next batch"
  // fetches against the cap.
  const needsMore = !filter && visibleEnd > allPools.length;
  useEffect(() => {
    if (!hasMore || loadingMore || !needsMore) return;
    let cancelled = false;
    (async () => {
      setLoadingMore(true);
      try {
        const res = await fetch(
          CACHE_KEYS.ammList(allPools.length, SERVER_PAGE_SIZE),
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const page: AMMListPage = await res.json();
        if (cancelled) return;
        setExtraPages((prev) => [...prev, ...page.pools]);
        setHasMore(page.hasMore);
      } catch (err) {
        console.error("[AMMList] Failed to backfill:", err);
      } finally {
        if (!cancelled) setLoadingMore(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsMore, hasMore, loadingMore, allPools.length]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const rangeEnd = Math.min(visibleEnd, sortedFiltered.length);
  const canPrev = pageIndex > 0;
  const canNext =
    visibleEnd < sortedFiltered.length || (!filter && hasMore && !loadingMore);

  // Range label mirrors TransactionList. When loaded rows haven't caught
  // up to the requested page (backfill in flight), surface "Loading…".
  const rangeLabel =
    sortedFiltered.length === 0
      ? "0 of 0"
      : visibleStart >= sortedFiltered.length
        ? "Loading…"
        : filter
          ? `${visibleStart + 1}–${rangeEnd} of ${sortedFiltered.length}`
          : `${visibleStart + 1}–${rangeEnd} of ${total}`;

  return (
    <div className="rounded-2xl bg-surface shadow-card">
      {/* Header bar — same shape as TokenSearch. */}
      <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            AMM Pools
          </span>
          <p className="font-mono text-cell font-medium text-muted">
            {filter
              ? `${sortedFiltered.length} of ${allPools.length} loaded`
              : `${allPools.length} of ${total} pools`}
          </p>
        </div>
        <div
          data-tip="markets-amm-search"
          className="flex w-full items-center gap-3 sm:w-auto"
        >
          <input
            type="text"
            aria-label="Filter AMM pools"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            maxLength={60}
            className="min-w-0 flex-1 rounded-full border border-elevated bg-elevated px-3 py-1 font-mono text-cell text-primary placeholder:text-muted outline-none transition-colors focus-visible:border-brand/30 sm:w-56 sm:flex-none"
          />
        </div>
      </div>

      {sortedFiltered.length === 0 && filter ? (
        <div className="p-8 text-center">
          <p className="font-mono text-body text-muted">
            No pools match your filter
          </p>
        </div>
      ) : (
        <AMMTable
          pools={visible}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}

      <Pagination
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n as PageSize);
          setPageIndex(0);
        }}
        onPrev={() => setPageIndex((p) => Math.max(0, p - 1))}
        onNext={() => setPageIndex((p) => p + 1)}
        canPrev={canPrev}
        canNext={canNext}
        rangeLabel={rangeLabel}
        itemLabel="AMM pools per page"
      />
    </div>
  );
}
