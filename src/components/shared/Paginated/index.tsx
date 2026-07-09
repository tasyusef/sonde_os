"use client";

import { useCallback, useState } from "react";
import Button from "@/components/shared/Button";

/**
 * Client-side pagination over a fully-loaded list. Use when the entire
 * dataset is already in memory (e.g. all trust lines paginated up-front
 * by useAccountData) and we just want to throttle initial render cost
 * by only displaying the first N items at a time.
 *
 * The visible count resets to `pageSize` whenever `total` changes — that
 * covers SWR revalidations and account switches in the same view. We use
 * the documented "derived state from props" pattern (set during render +
 * track previous value) instead of a useEffect, which the project's
 * react-hooks rule (set-state-in-effect) flags.
 * See: https://react.dev/reference/react/useState#storing-information-from-previous-renders
 */
export function usePagination(total: number, pageSize = 15) {
  const [visible, setVisible] = useState(pageSize);
  const [prevTotal, setPrevTotal] = useState(total);

  if (prevTotal !== total) {
    setPrevTotal(total);
    setVisible(pageSize);
  }

  const loadMore = useCallback(() => {
    setVisible((v) => Math.min(v + pageSize, total));
  }, [total, pageSize]);

  const showAll = useCallback(() => setVisible(total), [total]);

  const clamped = Math.min(visible, total);
  return {
    visible: clamped,
    hasMore: clamped < total,
    loadMore,
    showAll,
  };
}

/**
 * Footer with "Showing X of Y · Load More" — slot it under any list
 * that uses `usePagination`. Renders nothing when everything fits.
 */
export function LoadMoreFooter({
  visible,
  total,
  onLoadMore,
  onShowAll,
  label = "items",
  className = "",
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
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-elevated px-4 py-3 ${className}`}
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
