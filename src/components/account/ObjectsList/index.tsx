"use client";

import CopyButton from "@/components/shared/CopyButton";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";

export interface LedgerObject {
  LedgerEntryType: string;
  index: string;
  Flags?: number;
  [key: string]: unknown;
}

const KNOWN_META_KEYS = new Set([
  "LedgerEntryType", "index", "Flags", "PreviousTxnID",
  "PreviousTxnLgrSeq", "LedgerIndex",
]);

export default function ObjectsList({ objects }: { objects: LedgerObject[] }) {
  const { visible, hasMore, loadMore, showAll } = usePagination(objects.length, 15);
  const pageObjects = objects.slice(0, visible);

  if (objects.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">No ledger objects found</p>
      </div>
    );
  }

  // Group by type for summary
  const typeCounts: Record<string, number> = {};
  for (const obj of objects) {
    const type = obj.LedgerEntryType ?? "Unknown";
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => (
            <span
              key={type}
              className="rounded-tag px-2 py-0.5 font-mono text-tag font-medium bg-elevated text-secondary"
            >
              {type} ({count})
            </span>
          ))}
      </div>
      <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
        <table className="w-full">
          <thead>
            <tr className="border-b border-elevated">
              <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                Type
              </th>
              <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                Index
              </th>
              <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                Fields
              </th>
            </tr>
          </thead>
          <tbody>
            {pageObjects.map((obj, i) => {
              const fieldCount = Object.keys(obj).filter((k) => !KNOWN_META_KEYS.has(k)).length;
              const idx = obj.index ?? "";
              const truncatedIdx = idx.length > 12
                ? `${idx.slice(0, 6)}...${idx.slice(-6)}`
                : idx;

              return (
                <tr
                  key={idx ? `${idx}-${i}` : i}
                  className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
                >
                  <td className="px-4 py-row">
                    <span className="rounded-tag px-2 py-0.5 font-mono text-tag font-medium bg-elevated text-secondary">
                      {obj.LedgerEntryType}
                    </span>
                  </td>
                  <td className="px-4 py-row">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-cell text-primary">{truncatedIdx}</span>
                      {idx && <CopyButton text={idx} />}
                    </span>
                  </td>
                  <td className="px-4 py-row text-right font-mono text-cell text-secondary tabular-nums">
                    {fieldCount}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasMore && (
          <LoadMoreFooter
            visible={visible}
            total={objects.length}
            onLoadMore={loadMore}
            onShowAll={showAll}
            label="objects"
          />
        )}
      </div>
    </div>
  );
}
