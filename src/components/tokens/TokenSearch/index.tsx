"use client";

import { useState, useMemo, useEffect } from "react";
import useSWR from "swr";
import { type TokenListItem, type VolumePeriod } from "@/lib/token-types";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import TokenTable from "@/components/tokens/TokenTable";
import Toggle from "@/components/shared/Toggle";
import Pagination from "@/components/shared/Pagination";

const PERIODS = [
  { value: "24h" as const, label: "24H" },
  { value: "7d" as const, label: "7D" },
];

/** Server fetch chunk — fixed since the API page is a single PG round-
 *  trip and 100 rows is the cheapest natural unit. User-facing pagesize
 *  is independent (chosen from `PAGE_SIZE_OPTIONS`). */
const SERVER_PAGE_SIZE = 100;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type SortField = "volume" | "price" | "marketcap" | "holders" | "trustlines";
export type SortDir = "asc" | "desc";

interface TokenListResponse {
  tokens: TokenListItem[];
  total: number;
  hasMore: boolean;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function getSortValue(token: TokenListItem, field: SortField, period: VolumePeriod): number {
  switch (field) {
    case "volume":
      return (period === "7d" ? token.metrics.volume7d : token.metrics.volume24h) ?? 0;
    case "price":
      return token.metrics.price ?? 0;
    case "marketcap":
      return token.metrics.marketcap ?? 0;
    case "holders":
      return token.metrics.holders ?? 0;
    case "trustlines":
      return token.metrics.trustlines ?? 0;
  }
}

export default function TokenSearch({
  initialTokens,
  initialTotal,
  initialHasMore,
  initialSearch,
}: {
  initialTokens: TokenListItem[];
  initialTotal: number;
  initialHasMore: boolean;
  initialSearch?: string;
}) {
  const [filter, setFilter] = useState(initialSearch ?? "");
  const [period, setPeriod] = useState<VolumePeriod>("24h");
  const [sortField, setSortField] = useState<SortField>("volume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [pageSize, setPageSize] = useState<PageSize>(100);
  const [pageIndex, setPageIndex] = useState(0);

  // Page 0 via SWR with SSR fallback
  const { data: page0 } = useSWR<TokenListResponse>(
    CACHE_KEYS.tokenList(0, SERVER_PAGE_SIZE),
    fetcher,
    {
      fallbackData: {
        tokens: initialTokens,
        total: initialTotal,
        hasMore: initialHasMore,
      },
    },
  );

  // Additional pages backfilled transparently by the pagination effect
  // when the user advances past loaded rows.
  const [extraPages, setExtraPages] = useState<TokenListItem[]>([]);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  // Combine page 0 + extra pages
  const allTokens = useMemo(() => {
    const base = page0?.tokens ?? initialTokens;
    return [...base, ...extraPages];
  }, [page0?.tokens, initialTokens, extraPages]);

  const total = page0?.total ?? initialTotal;

  // Client-side price fetching via browser WS
  const priceMap = useTokenPrices(allTokens);

  // Enrich tokens with live prices + computed market cap. We always
  // compute market cap (price * supply) when possible — the previous
  // short-circuit that bailed out when priceMap was empty also skipped
  // the server-provided `metrics.price`, which left every row's market
  // cap null even when the data was present in `token_metadata`.
  const enrichedTokens = useMemo(() => {
    return allTokens.map((t) => {
      const key = `${t.currency}:${t.issuer}`;
      const price = priceMap.get(key) ?? t.metrics.price;
      const marketcap =
        price != null && t.metrics.totalSupply != null
          ? price * t.metrics.totalSupply
          : t.metrics.marketcap;
      if (price === t.metrics.price && marketcap === t.metrics.marketcap) return t;
      return {
        ...t,
        metrics: { ...t.metrics, price, marketcap },
      };
    });
  }, [allTokens, priceMap]);

  // Local filter — fast in-memory match against loaded pages
  const localFiltered = useMemo(() => {
    if (!filter) return enrichedTokens;
    const q = filter.toLowerCase();
    return enrichedTokens.filter(
      (t) =>
        t.currencyDisplay.toLowerCase().includes(q) ||
        t.currency.toLowerCase().includes(q) ||
        t.meta.name?.toLowerCase().includes(q) ||
        t.meta.issuerName?.toLowerCase().includes(q) ||
        t.issuer.toLowerCase().includes(q),
    );
  }, [enrichedTokens, filter]);

  // Backend search — kicks in when local results are empty so tokens past
  // the loaded leaderboard pages (e.g. memecoins like BWIF/FARM/BERT that
  // sink under low holder counts) are still findable by typing.
  const debouncedFilter = useDebouncedValue(filter.trim(), 250);
  const shouldSearchBackend =
    debouncedFilter.length >= 2 && localFiltered.length === 0;
  const { data: searchData, isLoading: searching } = useSWR<{
    tokens: TokenListItem[];
  }>(
    shouldSearchBackend ? CACHE_KEYS.tokenSearch(debouncedFilter, 20) : null,
    fetcher,
  );
  const remoteTokens = useMemo(
    () => searchData?.tokens ?? [],
    [searchData?.tokens],
  );
  const remotePriceMap = useTokenPrices(remoteTokens);
  const enrichedRemote = useMemo(() => {
    if (remotePriceMap.size === 0) return remoteTokens;
    return remoteTokens.map((t) => {
      const key = `${t.currency}:${t.issuer}`;
      const price = remotePriceMap.get(key) ?? t.metrics.price;
      const marketcap =
        price != null && t.metrics.totalSupply != null
          ? price * t.metrics.totalSupply
          : t.metrics.marketcap;
      if (price === t.metrics.price && marketcap === t.metrics.marketcap) return t;
      return { ...t, metrics: { ...t.metrics, price, marketcap } };
    });
  }, [remoteTokens, remotePriceMap]);

  // Combine + sort. When local has hits we use only local (fast path). When
  // local is empty we fall back to remote results.
  const filtered = useMemo(() => {
    const base = filter && localFiltered.length === 0 ? enrichedRemote : localFiltered;
    return base.toSorted((a, b) => {
      const aVal = getSortValue(a, sortField, period);
      const bVal = getSortValue(b, sortField, period);
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [filter, localFiltered, enrichedRemote, sortField, sortDir, period]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  // Reset pageIndex whenever filter or period changes — the React-
  // sanctioned mid-render setState pattern (compare to a stored prev
  // value; runtime short-circuits and re-renders with fresh state).
  const [prevResetKey, setPrevResetKey] = useState(`${filter}::${period}`);
  const resetKey = `${filter}::${period}`;
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPageIndex(0);
  }

  const visibleStart = pageIndex * pageSize;
  const visibleEnd = visibleStart + pageSize;
  const visible = filtered.slice(visibleStart, visibleEnd);

  // Transparent backfill — fire a next-chunk fetch when the user
  // advances past loaded rows. Only when filter is inactive (a tight
  // filter would otherwise loop "no matches in next batch" fetches
  // against the cap; the backend-search fallback above already covers
  // typed queries that miss the loaded set).
  const needsMore = !filter && visibleEnd > allTokens.length;
  useEffect(() => {
    if (!hasMore || loadingMore || !needsMore) return;
    let cancelled = false;
    (async () => {
      setLoadingMore(true);
      try {
        const res = await fetch(
          CACHE_KEYS.tokenList(allTokens.length, SERVER_PAGE_SIZE),
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const page: TokenListResponse = await res.json();
        if (cancelled) return;
        setExtraPages((prev) => [...prev, ...page.tokens]);
        setHasMore(page.hasMore);
      } catch (err) {
        console.error("[TokenSearch] Failed to backfill:", err);
      } finally {
        if (!cancelled) setLoadingMore(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsMore, hasMore, loadingMore, allTokens.length]);

  const rangeEnd = Math.min(visibleEnd, filtered.length);
  const canPrev = pageIndex > 0;
  const canNext =
    visibleEnd < filtered.length || (!filter && hasMore && !loadingMore);

  const rangeLabel =
    filtered.length === 0
      ? searching
        ? "Searching…"
        : "0 of 0"
      : visibleStart >= filtered.length
        ? "Loading…"
        : filter
          ? `${visibleStart + 1}–${rangeEnd} of ${filtered.length}`
          : `${visibleStart + 1}–${rangeEnd} of ${total}`;

  return (
    <div className="rounded-2xl bg-surface shadow-card">
      <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            Token List
          </span>
          <p className="font-mono text-cell font-medium text-muted">
            {filter
              ? searching
                ? "Searching…"
                : localFiltered.length === 0 && enrichedRemote.length > 0
                  ? `${enrichedRemote.length} match${enrichedRemote.length === 1 ? "" : "es"} from full index`
                  : `${filtered.length} of ${allTokens.length} loaded`
              : `${allTokens.length} of ${total} tokens`}
          </p>
        </div>
        <div
          data-tip="markets-search"
          className="flex w-full items-center gap-3 sm:w-auto"
        >
          <input
            type="text"
            aria-label="Filter tokens"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            maxLength={60}
            className="min-w-0 flex-1 rounded-full border border-elevated bg-elevated px-3 py-1 font-mono text-cell text-primary placeholder:text-muted outline-none transition-colors focus-visible:border-brand/30 sm:w-56 sm:flex-none"
          />
          <Toggle options={PERIODS} active={period} onChange={setPeriod} />
        </div>
      </div>
      <TokenTable
        tokens={visible}
        period={period}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
      />
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
        itemLabel="Tokens per page"
      />
    </div>
  );
}
