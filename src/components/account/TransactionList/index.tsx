import { useEffect, useMemo, useState } from "react";
import TypeTag from "@/components/shared/TypeTag";
import StatusBadge from "@/components/shared/StatusBadge";
import AddressLink from "@/components/shared/AddressLink";
import HashLink from "@/components/shared/HashLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import Pagination from "@/components/shared/Pagination";
import Button from "@/components/shared/Button";
import { formatDate } from "@/lib/xrpl-helpers";
import ListNotice, { type NoticeAction } from "@/components/shared/ListNotice";
import { txLoadDecision } from "@/components/account/TransactionsTab/tx-tab-state";
import { cell, thClass } from "@/lib/table";

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
  loadMoreFailed = false,
  onRetryLoadMore,
  emptyMessage = "No transactions found.",
  emptyAction,
  pagesLoaded = 0,
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
  /** The last `onLoadMore` failed. Callers should also pass
   *  `hasMore={false}` so the list stops auto-paging into the error. */
  loadMoreFailed?: boolean;
  onRetryLoadMore?: () => void;
  /** Shown only for a successful, empty result. */
  emptyMessage?: string;
  emptyAction?: NoticeAction;
  /** History pages fetched so far; a tag search fetches a bounded
   *  number of them per pass (`txLoadDecision`). */
  pagesLoaded?: number;
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
  // A tag search's pass counts from the first page, then restarts when
  // the filter changes or on "Search further".
  const [passStart, setPassStart] = useState(0);
  const [prevFilter, setPrevFilter] = useState(filterDestinationTag);
  if (prevFilter !== filterDestinationTag) {
    setPrevFilter(filterDestinationTag);
    setPageIndex(0);
    setPassStart(pagesLoaded);
  }
  const filtering = filterDestinationTag != null;

  // Fetch the next XRPL page when the visitor pages past what's loaded;
  // a tag search pauses after a few pages instead of walking the whole
  // history. `loadingMore` guards re-entry; once a page lands
  // `filtered` grows and this is re-evaluated.
  const load = txLoadDecision({
    needsMore: (pageIndex + 1) * pageSize > filtered.length,
    hasMore: hasMore && !!onLoadMore,
    loadingMore,
    filtering,
    pagesThisPass: pagesLoaded - passStart,
  });
  const autoLoad = load.autoLoad;
  useEffect(() => {
    if (autoLoad) onLoadMore?.();
  }, [autoLoad, onLoadMore]);

  // Past the loaded rows with nothing more coming (exhausted, a failed
  // load-more, or a paused search): show the last loaded page, not a
  // blank one.
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const page = (!hasMore || load.paused) && pageIndex > lastPage ? lastPage : pageIndex;

  const visibleStart = page * pageSize;
  const visibleEnd = visibleStart + pageSize;
  const visible = filtered.slice(visibleStart, visibleEnd);

  const searched = transactions.length.toLocaleString();
  const searchFurther = () => setPassStart(pagesLoaded);

  if (filtered.length === 0 && !loadingMore && !loadMoreFailed) {
    return (
      <ListNotice
        message={
          !filtering
            ? emptyMessage
            : load.paused
              ? `No transactions with destination tag ${filterDestinationTag} in the latest ${searched}.`
              : `No transactions with destination tag ${filterDestinationTag}.`
        }
        action={load.paused ? { label: "Search further", onClick: searchFurther } : emptyAction}
      />
    );
  }

  // "12 of 80" style label. "+" suffix when there are still unfetched
  // pages on the server, so the count isn't a lie when the XRPL side
  // has more beyond what we've pulled.
  const totalLabel = hasMore ? `${filtered.length}+` : `${filtered.length}`;
  const rangeEnd = Math.min(visibleEnd, filtered.length);
  const canPrev = page > 0;
  const canNext = visibleEnd < filtered.length || (hasMore && !loadingMore && !load.paused);

  const th = `${thClass} text-left`;

  return (
    <>
      <table className="w-full">
        <thead className="hidden sm:table-header-group">
          <tr className="border-b border-line">
            <th scope="col" className={th}>Type</th>
            {/* sm to lg-1: one combined column. lg+: split into Hash + From/To. */}
            <th scope="col" className={`${th} lg:hidden`}>
              Hash / From → To
            </th>
            <th scope="col" className={`${th} hidden lg:table-cell`}>
              Hash
            </th>
            <th scope="col" className={`${th} hidden lg:table-cell`}>
              From / To
            </th>
            <th scope="col" className={th}>Amount</th>
            <th scope="col" className={th}>Date</th>
            <th scope="col" className={th}>Status</th>
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
                className="block border-b border-line last:border-b-0 hover:bg-row-hover sm:table-row"
              >
                {/* Mobile stacked layout in a single cell; desktop cells
                     below hidden on mobile. */}
                <td colSpan={7} className="block py-row sm:hidden">
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

                <td className={`${cell} hidden sm:table-cell sm:pl-0`}>
                  <TypeTag txType={txType} />
                </td>
                <td className={`${cell} hidden sm:table-cell lg:hidden`}>
                  <div className="flex flex-col gap-1">
                    <HashLink hash={hash} />
                    {counterparty ? (
                      <AddressLink address={counterparty} />
                    ) : (
                      <span className="font-mono text-cell text-muted">—</span>
                    )}
                  </div>
                </td>
                <td className={`${cell} hidden lg:table-cell`}>
                  <HashLink hash={hash} />
                </td>
                <td className={`${cell} hidden lg:table-cell`}>
                  {counterparty ? (
                    <AddressLink address={counterparty} />
                  ) : (
                    <span className="font-mono text-cell text-muted">—</span>
                  )}
                </td>
                <td className={`${cell} hidden sm:table-cell`}>
                  {hasAmount ? (
                    <AmountDisplay
                      drops={isOutgoing ? `-${drops}` : drops}
                      showSign
                    />
                  ) : (
                    <span className="font-mono text-cell text-muted">—</span>
                  )}
                </td>
                <td className={`${cell} hidden sm:table-cell`}>
                  <span className="whitespace-nowrap font-mono text-cell text-primary">
                    {dateLabel}
                  </span>
                </td>
                <td className={`${cell} hidden sm:table-cell`}>
                  <StatusBadge status={isSuccess ? "success" : "error"} />
                </td>
              </tr>
            );
          })}
          {visible.length === 0 && loadingMore && (
            <tr>
              <td colSpan={7} className="py-8 text-center">
                <span className="font-mono text-cell text-muted">Loading…</span>
              </td>
            </tr>
          )}
          {load.paused && (
            <tr>
              <td colSpan={7} className="py-4">
                <div className="flex flex-wrap items-center justify-center gap-3 text-center">
                  <span className="font-mono text-cell text-muted">
                    Searched the latest {searched} transactions.
                  </span>
                  <Button variant="secondary" size="sm" onClick={searchFurther}>
                    Search further
                  </Button>
                </div>
              </td>
            </tr>
          )}
          {loadMoreFailed && !loadingMore && (
            <tr>
              <td colSpan={7} className="py-4">
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-center gap-3 text-center"
                >
                  <span className="font-mono text-cell text-error">
                    Couldn&apos;t load more transactions.
                  </span>
                  {onRetryLoadMore && (
                    <Button variant="secondary" size="sm" onClick={onRetryLoadMore}>
                      Retry
                    </Button>
                  )}
                </div>
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
        onPrev={() => setPageIndex(Math.max(0, page - 1))}
        onNext={() => setPageIndex(page + 1)}
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
    </>
  );
}
