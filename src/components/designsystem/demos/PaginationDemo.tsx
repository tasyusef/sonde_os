"use client";

import { useState } from "react";
import Pagination from "@/components/shared/Pagination";
import DemoCard from "../shared/DemoCard";
import { ToggleControl } from "../shared/PropControl";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export default function PaginationDemo() {
  // Pretend we have 80 items total and they're all loaded so the user
  // can flip back and forth — the demo only needs to show the chrome.
  const TOTAL = 80;
  const [pageSize, setPageSize] = useState<number>(10);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const visibleStart = pageIndex * pageSize;
  const visibleEnd = Math.min(visibleStart + pageSize, TOTAL);
  const canPrev = pageIndex > 0;
  const canNext = visibleEnd < TOTAL;

  // Demo with a `+` suffix when there are more pages server-side that
  // haven't been loaded yet — caller decides how to format the total.
  const totalLabel = hasMore ? `${TOTAL}+` : `${TOTAL}`;
  const rangeLabel = `${visibleStart + 1}–${visibleEnd} of ${totalLabel}`;

  return (
    <DemoCard
      name="Pagination"
      importPath="@/components/shared/Pagination"
      description="Pagination footer with page-size select, range label, and prev/next chevrons. Used inside list/table cards (e.g. TransactionList, AMMList, TokenSearch)."
      preview={
        <div className="w-full rounded-2xl border border-elevated bg-surface">
          <div className="px-4 py-8 text-center">
            <span className="font-mono text-cell text-muted">
              (list/table goes here)
            </span>
          </div>
          <Pagination
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPageIndex(0);
            }}
            onPrev={() => setPageIndex((p) => Math.max(0, p - 1))}
            onNext={() => setPageIndex((p) => p + 1)}
            canPrev={canPrev}
            canNext={canNext}
            rangeLabel={rangeLabel}
          />
        </div>
      }
      controls={
        <ToggleControl
          label="hasMore (server)"
          checked={hasMore}
          onChange={setHasMore}
        />
      }
      code={`<Pagination
  pageSize={${pageSize}}
  pageSizeOptions={[10, 25, 50]}
  onPageSizeChange={...}
  onPrev={...}
  onNext={...}
  canPrev={${canPrev}}
  canNext={${canNext}}
  rangeLabel="${rangeLabel}"
/>`}
    />
  );
}
