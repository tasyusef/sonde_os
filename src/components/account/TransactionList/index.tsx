"use client";

import { useEffect, useMemo, useState } from "react";
import TypeTag from "@/components/shared/TypeTag";
import StatusBadge from "@/components/shared/StatusBadge";
import AddressLink from "@/components/shared/AddressLink";
import HashLink from "@/components/shared/HashLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import Pagination from "@/components/shared/Pagination";
import { formatDate } from "@/lib/xrpl-helpers";

interface Transaction {
  tx: Record<string, unknown>;
  meta: Record<string, unknown>;
  validated: boolean;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export default function TransactionList({
  transactions,
  address,
  filterDestinationTag,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
}: {
  transactions: Transaction[];
  address: string;
  filterDestinationTag?: number | null;
  /** True when a next marker exists on the XRPL side and more pages can
   *  be fetched beyond what's in `transactions`. */
  hasMore?: boolean;
  /** Trigger a forward fetch when the user clicks "next" past the edge
   *  of what's been loaded. */
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [pageIndex, setPageIndex] = useState(0);

  // Filter by destination tag if specified
  const filtered = useMemo(
    () =>
      filterDestinationTag != null
        ? transactions.filter((item) => {
            const tx = item.tx as Record<string, unknown>;
            return (
              (tx.DestinationTag as number) === filterDestinationTag ||
              (tx.SourceTag as number) === filterDestinationTag
            );
          })
        : transactions,
    [transactions, filterDestinationTag],
  );

  // Reset pageIndex to 0 when the filter changes. React explicitly
  // supports this pattern (setState during render when comparing a
  // stored-previous value) and the runtime will short-circuit the
  // render to re-run with the fresh state before committing.
  const [prevFilter, setPrevFilter] = useState(filterDestinationTag);
  if (prevFilter !== filterDestinationTag) {
    setPrevFilter(filterDestinationTag);
    setPageIndex(0);
  }

  const visibleStart = pageIndex * pageSize;
  const visibleEnd = visibleStart + pageSize;
  const visible = filtered.slice(visibleStart, visibleEnd);

  // Transparently fetch the next XRPL page when the user advances past
  // what's already loaded. `loadingMore` guards against re-entrancy
  // while a request is in flight; once the response lands `filtered`
  // grows and we re-evaluate whether another fetch is still needed.
  const needsMore = visibleEnd > filtered.length;
  useEffect(() => {
    if (!onLoadMore || !hasMore || loadingMore) return;
    if (!needsMore) return;
    onLoadMore();
  }, [needsMore, hasMore, loadingMore, onLoadMore]);

  if (filtered.length === 0 && !loadingMore) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">
          {filterDestinationTag != null
            ? `No transactions with destination tag ${filterDestinationTag}`
            : "No transactions found"}
        </p>
      </div>
    );
  }

  // "12 of 80" style label. "+" suffix when there are still unfetched
  // pages on the server, so the count isn't a lie when the XRPL side
  // has more beyond what we've pulled.
  const totalLabel = hasMore ? `${filtered.length}+` : `${filtered.length}`;
  const rangeEnd = Math.min(visibleEnd, filtered.length);
  const canPrev = pageIndex > 0;
  const canNext = visibleEnd < filtered.length || (hasMore && !loadingMore);

  const thClass =
    "px-3 sm:px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted";

  return (
    <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
      <table className="w-full">
        <thead className="hidden sm:table-header-group">
          <tr className="border-b border-elevated">
            <th scope="col" className={thClass}>Type</th>
            {/* sm to lg-1: one combined column. lg+: split into Hash + From/To. */}
            <th scope="col" className={`${thClass} lg:hidden`}>
              Hash / From → To
            </th>
            <th scope="col" className={`${thClass} hidden lg:table-cell`}>
              Hash
            </th>
            <th scope="col" className={`${thClass} hidden lg:table-cell`}>
              From / To
            </th>
            <th scope="col" className={thClass}>Amount</th>
            <th scope="col" className={thClass}>Date</th>
            <th scope="col" className={thClass}>Status</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item, i) => {
            const tx = item.tx as Record<string, unknown>;
            const meta = item.meta as Record<string, unknown>;
            const txType = (tx.TransactionType as string) ?? "Unknown";
            const hash = (tx.hash as string) ?? "";
            const account = (tx.Account as string) ?? "";
            const destination = (tx.Destination as string) ?? "";
            const result =
              ((meta.TransactionResult as string) ?? "");
            const isSuccess = result === "tesSUCCESS";
            const date = tx.date as number | undefined;

            const amount = tx.Amount;
            const drops =
              typeof amount === "string"
                ? amount
                : typeof amount === "object" && amount !== null
                  ? (amount as { value?: string }).value ?? "0"
                  : "0";
            const isXrp = typeof amount === "string";
            const hasAmount = isXrp && drops !== "0";

            const isOutgoing = account === address;
            const counterparty = isOutgoing ? destination : account;
            const dateLabel = date ? formatDate(date) : "—";

            return (
              <tr
                key={`${hash}-${visibleStart + i}`}
                className="block border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover sm:table-row"
              >
                {/* Mobile stacked layout in a single cell; desktop cells
                     below hidden on mobile. */}
                <td
                  colSpan={7}
                  className="block px-3 py-3 sm:hidden"
                >
                  <div className="flex items-center justify-between gap-2">
                    <TypeTag txType={txType} />
                    <StatusBadge status={isSuccess ? "success" : "error"} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-cell">
                    <HashLink hash={hash} />
                    {hasAmount ? (
                      <AmountDisplay
                        drops={isOutgoing ? `-${drops}` : drops}
                        showSign
                      />
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    {counterparty ? (
                      <AddressLink address={counterparty} />
                    ) : (
                      <span className="font-mono text-cell text-muted">—</span>
                    )}
                    <span className="font-mono text-tag text-muted">
                      {dateLabel}
                    </span>
                  </div>
                </td>

                <td className="hidden px-4 py-row sm:table-cell">
                  <TypeTag txType={txType} />
                </td>
                <td className="hidden px-4 py-row sm:table-cell lg:hidden">
                  <div className="flex flex-col gap-1">
                    <HashLink hash={hash} />
                    {counterparty ? (
                      <AddressLink address={counterparty} />
                    ) : (
                      <span className="font-mono text-cell text-muted">—</span>
                    )}
                  </div>
                </td>
                <td className="hidden px-4 py-row lg:table-cell">
                  <HashLink hash={hash} />
                </td>
                <td className="hidden px-4 py-row lg:table-cell">
                  {counterparty ? (
                    <AddressLink address={counterparty} />
                  ) : (
                    <span className="font-mono text-cell text-muted">—</span>
                  )}
                </td>
                <td className="hidden px-4 py-row sm:table-cell">
                  {hasAmount ? (
                    <AmountDisplay
                      drops={isOutgoing ? `-${drops}` : drops}
                      showSign
                    />
                  ) : (
                    <span className="font-mono text-cell text-muted">—</span>
                  )}
                </td>
                <td className="hidden px-4 py-row sm:table-cell">
                  <span className="whitespace-nowrap font-mono text-cell text-secondary">
                    {dateLabel}
                  </span>
                </td>
                <td className="hidden px-4 py-row sm:table-cell">
                  <StatusBadge status={isSuccess ? "success" : "error"} />
                </td>
              </tr>
            );
          })}
          {visible.length === 0 && loadingMore && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center">
                <span className="font-mono text-cell text-muted">Loading…</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>

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
        rangeLabel={
          filtered.length === 0
            ? "0 of 0"
            : visibleStart >= filtered.length
              ? "Loading…"
              : `${visibleStart + 1}–${rangeEnd} of ${totalLabel}`
        }
        itemLabel="Transactions per page"
      />
    </div>
  );
}
