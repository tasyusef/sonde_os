/**
 * Pure view logic for the account Transactions tab. Kept apart from the
 * component so the loading / error / empty split is unit-tested: a
 * failed request must never read as "this account has no transactions".
 */

export type TxListView = "loading" | "error" | "empty" | "list";

export function txListView({
  loading,
  failed,
  itemCount,
}: {
  /** No first page yet, and none is known to have failed. */
  loading: boolean;
  failed: boolean;
  itemCount: number;
}): TxListView {
  if (loading) return "loading";
  if (failed) return "error";
  return itemCount === 0 ? "empty" : "list";
}

/** Status line above the table. `null` while the initial request has
 *  failed: the error card says it, and a "Showing 0" would contradict it.
 *  With a tag filter the count is what's been searched, not shown. */
export function txStatusCopy({
  visibleCount,
  isFetching,
  failed,
  filtering = false,
}: {
  visibleCount: number;
  isFetching: boolean;
  failed: boolean;
  filtering?: boolean;
}): string | null {
  if (failed && !isFetching) return null;
  const visible = visibleCount.toLocaleString();
  if (isFetching && visibleCount === 0) return "Loading transactions";
  if (filtering) return `${isFetching ? "Searching" : "Searched"} ${visible} transactions`;
  if (isFetching) return `Loading ${visible} transactions`;
  return `Showing ${visible} transactions`;
}

/** Pages a destination-tag search fetches on its own before it asks to
 *  go further (500 transactions). Without a cap, a tag no transaction
 *  carries walks the account's whole history. */
export const FILTER_PASS_PAGES = 10;

export interface LoadDecision {
  /** Fetch the next page now. */
  autoLoad: boolean;
  /** The search's page budget is spent and older history remains:
   *  wait for "Search further". */
  paused: boolean;
}

/** Whether the list fetches the next page by itself. It does when the
 *  visitor pages past what's loaded; a filtered list stops after
 *  `FILTER_PASS_PAGES` pages per pass. */
export function txLoadDecision({
  needsMore,
  hasMore,
  loadingMore,
  filtering,
  pagesThisPass,
}: {
  /** The page being viewed runs past the loaded (matching) rows. */
  needsMore: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  filtering: boolean;
  /** Pages loaded since the filter was set or "Search further" was hit. */
  pagesThisPass: number;
}): LoadDecision {
  const wants = needsMore && hasMore && !loadingMore;
  const budgetLeft = !filtering || pagesThisPass < FILTER_PASS_PAGES;
  return { autoLoad: wants && budgetLeft, paused: wants && !budgetLeft };
}
