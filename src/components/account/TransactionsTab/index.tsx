/**
 * TransactionsTab — the account's history from `account_tx`, newest
 * first. The list pages through what's loaded and fetches the next
 * 50 when the visitor pages past the end. A destination-tag search
 * fetches up to `FILTER_PASS_PAGES` pages, then asks to search further.
 *
 * A failed fetch stays a failure: it renders an error card with Retry,
 * never the empty state (public nodes rate-limit, so this is routine).
 */

import TransactionList from "@/components/account/TransactionList";
import ListNotice from "@/components/shared/ListNotice";
import LoadingDots from "@/components/shared/LoadingDots";
import { useAccountTx } from "@/hooks/useAccountTx";
import { txListView, txStatusCopy } from "./tx-tab-state";

export default function TransactionsTab({
  address,
  filterDestinationTag,
}: {
  address: string;
  filterDestinationTag?: number | null;
}) {
  const history = useAccountTx(address);
  const view = txListView({
    loading: history.loading,
    failed: history.failed,
    itemCount: history.items.length,
  });

  return (
    <div className="space-y-3">
      <TxStatusRow
        visibleCount={history.items.length}
        isFetching={view === "loading" || history.loadingMore}
        failed={view === "error"}
        filtering={filterDestinationTag != null}
      />
      {view === "error" ? (
        <ListNotice
          tone="error"
          message="Couldn't load transactions."
          action={{ label: "Retry", onClick: history.retry }}
        />
      ) : (
        <TransactionList
          transactions={history.items}
          address={address}
          filterDestinationTag={filterDestinationTag}
          hasMore={history.hasMore}
          onLoadMore={history.loadMore}
          loadingMore={view === "loading" || history.loadingMore}
          loadMoreFailed={history.moreFailed}
          onRetryLoadMore={history.retryMore}
          pagesLoaded={history.pagesLoaded}
        />
      )}
    </div>
  );
}

/** Status line above the table: "{Loading|Showing} N transactions",
 *  with the dots while a fetch is in flight. */
function TxStatusRow({
  visibleCount,
  isFetching,
  failed,
  filtering,
}: {
  visibleCount: number;
  isFetching: boolean;
  /** Initial request failed; the error card below carries the message. */
  failed: boolean;
  filtering: boolean;
}) {
  const copy = txStatusCopy({ visibleCount, isFetching, failed, filtering });
  return (
    <div
      className="flex min-h-5 items-center gap-2 font-mono text-tag text-muted"
      role="status"
      aria-live="polite"
    >
      {isFetching && <LoadingDots className="text-brand" />}
      {copy && <span>{copy}</span>}
    </div>
  );
}
