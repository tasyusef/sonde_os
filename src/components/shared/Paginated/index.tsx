import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Button from "@/components/shared/Button";
import { cn } from "@/lib/utils";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus a row, or the first control inside it (table rows aren't
 *  focusable themselves). A row with no control takes focus directly. */
function focusRow(row: Element | undefined) {
  if (!(row instanceof HTMLElement)) return;
  const target = row.matches(FOCUSABLE) ? row : row.querySelector<HTMLElement>(FOCUSABLE);
  if (!target) row.tabIndex = -1;
  (target ?? row).focus();
}

/**
 * Client-side pagination over a fully-loaded list. Use when the entire
 * dataset is already in memory (e.g. all trust lines paginated up-front
 * by useAccountTrustLines) and we just want to throttle initial render cost
 * by only displaying the first N items at a time.
 *
 * The visible count resets to `pageSize` whenever `total` changes — that
 * covers SWR revalidations and account switches in the same view. We use
 * the documented "derived state from props" pattern (set during render +
 * track previous value) instead of a useEffect, which the project's
 * react-hooks rule (set-state-in-effect) flags.
 * See: https://react.dev/reference/react/useState#storing-information-from-previous-renders
 *
 * Put `listRef` on the element whose children are the rows (`<tbody>`,
 * a grid). Load More / Show all then move focus to the first new row, so
 * keyboard and screen-reader users land on what they asked for, and
 * focus isn't dropped to <body> when the footer unmounts after the last
 * page.
 */
export function usePagination(total: number, pageSize = 15) {
  const [visible, setVisible] = useState(pageSize);
  const [prevTotal, setPrevTotal] = useState(total);
  const list = useRef<HTMLElement | null>(null);

  if (prevTotal !== total) {
    setPrevTotal(total);
    setVisible(pageSize);
  }

  const clamped = Math.min(visible, total);

  // Render the new rows synchronously so the first one exists to focus.
  const reveal = (next: number) => {
    flushSync(() => setVisible(next));
    focusRow(list.current?.children[clamped]);
  };

  // A callback ref, so it fits any element type (<tbody>, <div>).
  const listRef = useCallback((el: HTMLElement | null) => {
    list.current = el;
  }, []);

  return {
    visible: clamped,
    hasMore: clamped < total,
    loadMore: () => reveal(Math.min(clamped + pageSize, total)),
    showAll: () => reveal(total),
    listRef,
  };
}

/**
 * Footer with "Showing X of Y · Load More" — slot it under any list
 * that uses `usePagination`. Flush with the page ground, a rule above.
 * Renders nothing when everything fits.
 */
export function LoadMoreFooter({
  visible,
  total,
  onLoadMore,
  onShowAll,
  label = "items",
  className,
}: {
  visible: number;
  total: number;
  onLoadMore: () => void;
  onShowAll?: () => void;
  /** Plural noun describing what's being paginated, e.g. "trust lines". */
  label?: string;
  /** Extra classes to merge with the default footer container. */
  className?: string;
}) {
  if (visible >= total) return null;
  const remaining = total - visible;
  return (
    <div
      className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-line py-3", className)}
    >
      <span className="font-mono text-tag text-muted">
        Showing {visible.toLocaleString()} of {total.toLocaleString()} {label}
      </span>
      <div className="flex items-center gap-2">
        {onShowAll && remaining > 15 && (
          <Button onClick={onShowAll} variant="secondary" size="md">
            Show all
          </Button>
        )}
        <Button onClick={onLoadMore} variant="outline" size="md">
          Load More
        </Button>
      </div>
    </div>
  );
}
