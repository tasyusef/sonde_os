"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import TransactionList from "@/components/account/TransactionList";
import Button from "@/components/shared/Button";
import ResponsiveSelect from "@/components/shared/ResponsiveSelect";

interface Transaction {
  tx: Record<string, unknown>;
  meta: Record<string, unknown>;
  validated: boolean;
}

interface ActivityResponse {
  transactions: Transaction[];
  marker: string | null;
  hasMore: boolean;
}

/** Type-filter options. `"all"` is the no-filter sentinel — mapped
 *  back to `null` for the API param. ResponsiveSelect requires a
 *  string value type, hence the sentinel. Per the design system
 *  (CLAUDE.md): 5+ options use `desktopVariant="select"` so the
 *  trigger stays a tight dropdown instead of a wide Toggle pill row.*/
const TYPE_FILTERS = [
  { value: "all", label: "All", apiParam: null },
  { value: "Payment", label: "Payments", apiParam: "Payment" },
  {
    value: "DEX",
    label: "DEX",
    apiParam: "OfferCreate,OfferCancel",
  },
  {
    value: "NFT",
    label: "NFT",
    apiParam:
      "NFTokenMint,NFTokenBurn,NFTokenCreateOffer,NFTokenAcceptOffer,NFTokenCancelOffer",
  },
  { value: "TrustSet", label: "Trust", apiParam: "TrustSet" },
  {
    value: "AMM",
    label: "AMM",
    apiParam: "AMMCreate,AMMDeposit,AMMWithdraw,AMMVote,AMMBid,AMMDelete",
  },
  {
    value: "Escrow",
    label: "Escrow",
    apiParam: "EscrowCreate,EscrowFinish,EscrowCancel",
  },
] as const;

type TypeFilterValue = (typeof TYPE_FILTERS)[number]["value"];

function apiParamFor(value: TypeFilterValue): string | null {
  return TYPE_FILTERS.find((f) => f.value === value)?.apiParam ?? null;
}

export default function ActivityPanel() {
  const { address: authAddress } = useAuth();
  const address = authAddress ?? "";
  const { tier } = useSubscription();
  const isPro = tier === "pro";

  const [typeFilter, setTypeFilter] = useState<TypeFilterValue>("all");
  const [appendedPages, setAppendedPages] = useState<ActivityResponse[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const apiType = apiParamFor(typeFilter);

  // Reset appended pages when filter changes (adjust state during render pattern).
  const [prevTypeFilter, setPrevTypeFilter] =
    useState<TypeFilterValue>(typeFilter);
  if (typeFilter !== prevTypeFilter) {
    setPrevTypeFilter(typeFilter);
    setAppendedPages([]);
  }

  // Initial fetch — SWR drives the first page
  const { data, isLoading, error } = useSWR<ActivityResponse>(
    CACHE_KEYS.portfolioActivity(apiType ?? undefined),
    fetcher,
    { keepPreviousData: false },
  );

  // Derived pagination state: last appended page wins, falling back to SWR data.
  const lastPage = appendedPages[appendedPages.length - 1];
  const marker = lastPage?.marker ?? data?.marker ?? null;
  const hasMore = lastPage?.hasMore ?? data?.hasMore ?? false;
  const allTransactions = [
    ...(data?.transactions ?? []),
    ...appendedPages.flatMap((p) => p.transactions),
  ];

  // Load more (append)
  const loadMore = useCallback(async () => {
    if (!marker || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: "50", marker });
      if (apiType) params.set("type", apiType);
      const res = await fetch(`/api/portfolio/activity?${params}`);
      if (!res.ok) throw new Error("Failed to load more");
      const result: ActivityResponse = await res.json();
      setAppendedPages((prev) => [...prev, result]);
    } catch (err) {
      console.error("[ActivityPanel] Load more error:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [marker, apiType, loadingMore]);

  return (
    <section className="flex flex-col gap-4">
      {/* Filter bar + Export */}
      <div className="flex flex-wrap items-center gap-2">
        <ResponsiveSelect<TypeFilterValue>
          options={TYPE_FILTERS.map((f) => ({
            value: f.value,
            label: f.label,
          }))}
          active={typeFilter}
          onChange={setTypeFilter}
          ariaLabel="Filter activity by transaction type"
          desktopVariant="select"
        />

        {/* CSV export is Pro-gated server-side. For non-Pro users,
            render the same button shape as a CTA to /pricing with a
            Pro pill suffix so they know what they're missing. */}
        <div className="ml-auto">
          {isPro ? (
            <a
              href="/api/portfolio/activity/export"
              download
              aria-label="Export activity as CSV"
              title="Export activity as CSV"
              className="flex items-center gap-1.5 rounded-lg border border-elevated px-3 py-1.5 font-mono text-label font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
            </a>
          ) : (
            <Link
              href="/pricing"
              aria-label="Upgrade to Pro to export activity as CSV"
              title="CSV export is a Pro feature"
              className="flex items-center gap-1.5 rounded-lg border border-elevated px-3 py-1.5 font-mono text-label font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
              <span className="rounded-tag bg-brand/10 px-1.5 py-0.5 font-mono text-micro font-semibold uppercase tracking-pill text-brand">
                Pro
              </span>
            </Link>
          )}
        </div>
      </div>

      {/* Transaction list */}
      {isLoading && allTransactions.length === 0 ? (
        <div
          className="flex h-32 items-center justify-center rounded-2xl bg-surface shadow-card"
          role="status"
          aria-label="Loading activity"
        >
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      ) : error && allTransactions.length === 0 ? (
        <div
          role="alert"
          className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl bg-surface px-4 text-center shadow-card"
        >
          <p className="font-mono text-cell text-error">Couldn&apos;t load activity.</p>
          <p className="font-mono text-tag text-muted">Try refreshing the page.</p>
        </div>
      ) : allTransactions.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-2xl bg-surface shadow-card">
          <p className="font-mono text-body text-muted">
            {typeFilter !== "all"
              ? "No matching transactions"
              : "No transactions found"}
          </p>
        </div>
      ) : (
        <>
          <TransactionList transactions={allTransactions} address={address} />

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center">
              <Button
                onClick={loadMore}
                loading={loadingMore}
                variant="outline"
                size="md"
              >
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
