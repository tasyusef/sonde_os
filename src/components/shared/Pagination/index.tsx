import { useId } from "react";
import Button from "@/components/shared/Button";
import PixelIcon from "@/components/shared/PixelIcon";

interface PaginationProps {
  /** Current page-size value (rows per page). */
  pageSize: number;
  /** Options shown in the page-size select. */
  pageSizeOptions: readonly number[];
  /** Called when the user changes page size — caller is responsible for
   *  resetting `pageIndex` so the user lands somewhere sensible. */
  onPageSizeChange: (size: number) => void;

  /** Prev-page click handler. */
  onPrev: () => void;
  /** Next-page click handler. Caller is responsible for transparently
   *  firing an upstream "load more" fetch when the requested next page
   *  extends past loaded data. */
  onNext: () => void;
  /** Disable the Prev button when there's no earlier page to go to. */
  canPrev: boolean;
  /** Disable the Next button when there's no later page to go to (and
   *  no server-side data left to fetch). */
  canNext: boolean;

  /** Pre-formatted range label rendered between the count and the
   *  chevrons. Examples: `"11–20 of 549"`, `"11–20 of 80+"`, `"Loading…"`,
   *  `"0 of 0"`. The caller knows loaded/total/loading state — this
   *  component just paints whatever string it's handed. */
  rangeLabel: string;

  /** Accessible label for the page-size select (sr-only). Defaults to
   *  "Items per page"; consumers should set this to a more specific
   *  noun (e.g. "Transactions per page") for screen readers. */
  itemLabel?: string;
}

/**
 * Pagination footer — page-size selector on the left, range label +
 * chevron prev/next on the right. Sits under a list or table on the page
 * ground, flush with its edges; renders its own rule above so callers
 * don't need a wrapper.
 *
 * Originated as the inline pagination block on `TransactionList`; lifted
 * out so the Tokens and AMM listings can share the same UX. The
 * "page-size 10/25/50 → range label → chevrons" pattern lets users jump
 * back to an earlier page (something the old "View More" infinite-scroll
 * style didn't allow) and combines transparently with upstream marker-
 * or offset-based fetches when the user advances past what's loaded.
 */
export default function Pagination({
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  onPrev,
  onNext,
  canPrev,
  canNext,
  rangeLabel,
  itemLabel = "Items per page",
}: PaginationProps) {
  const selectId = useId();

  return (
    <div className="flex flex-col items-start justify-between gap-3 border-t border-line py-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 font-mono text-label text-muted">
        <span>Show</span>
        <label className="sr-only" htmlFor={selectId}>
          {itemLabel}
        </label>
        <select
          id={selectId}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="border border-line bg-surface px-2 py-1 font-mono text-body text-primary sm:text-label"
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span>per page</span>
      </div>

      <div className="flex items-center gap-3">
        <span className="font-mono text-label text-muted tabular-nums">
          {rangeLabel}
        </span>
        <div className="flex items-center gap-1">
          <Button
            onClick={onPrev}
            disabled={!canPrev}
            aria-label="Previous page"
            variant="outline"
            size="sm"
            iconOnly
          >
            <PixelIcon name="chevron-left" />
          </Button>
          <Button
            onClick={onNext}
            disabled={!canNext}
            aria-label="Next page"
            variant="outline"
            size="sm"
            iconOnly
          >
            <PixelIcon name="chevron-right" />
          </Button>
        </div>
      </div>
    </div>
  );
}
