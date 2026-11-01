import CopyButton from "@/components/shared/CopyButton";
import ListNotice from "@/components/shared/ListNotice";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { cell, thClass } from "@/lib/table";

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

/**
 * Every ledger object the account owns, with a count per type above.
 * Mobile-first:
 *
 *   Mobile (<sm): Type (+ Index) | Fields
 *   sm+:          Type | Index | Fields
 */
export default function ObjectsList({ objects }: { objects: LedgerObject[] }) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(objects.length, 15);
  const pageObjects = objects.slice(0, visible);

  if (objects.length === 0) {
    return <ListNotice message="No ledger objects found." />;
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
              className="rounded-tag px-2 py-0.5 font-mono text-tag font-medium bg-elevated text-primary"
            >
              {type} ({count})
            </span>
          ))}
      </div>
      <div>
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-auto" />
            <col className="hidden sm:table-column sm:w-[40%]" />
            <col className="w-20" />
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={`${thClass} text-left`}>
                <span className="sm:hidden">Type / Index</span>
                <span className="hidden sm:inline">Type</span>
              </th>
              <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
                Index
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Fields
              </th>
            </tr>
          </thead>
          <tbody ref={listRef}>
            {pageObjects.map((obj, i) => {
              const fieldCount = Object.keys(obj).filter((k) => !KNOWN_META_KEYS.has(k)).length;
              const idx = obj.index ?? "";
              const truncatedIdx = idx.length > 12
                ? `${idx.slice(0, 6)}...${idx.slice(-6)}`
                : idx;

              return (
                <tr
                  key={idx ? `${idx}-${i}` : i}
                  className="border-b border-line last:border-b-0 hover:bg-row-hover"
                >
                  <td className={`${cell} align-top`}>
                    <span className="rounded-tag px-2 py-0.5 font-mono text-tag font-medium bg-elevated text-primary">
                      {obj.LedgerEntryType}
                    </span>
                    {/* Mobile-only Index; its own column from sm. */}
                    <span className="mt-1 block sm:hidden">
                      <span className="sr-only">Index </span>
                      <ObjectIndex idx={idx} truncated={truncatedIdx} />
                    </span>
                  </td>
                  <td className={`${cell} hidden align-top sm:table-cell`}>
                    <ObjectIndex idx={idx} truncated={truncatedIdx} />
                  </td>
                  <td className={`${cell} text-right align-top font-mono text-cell text-primary tabular-nums`}>
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

function ObjectIndex({ idx, truncated }: { idx: string; truncated: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-cell text-primary">{truncated}</span>
      {idx && <CopyButton text={idx} />}
    </span>
  );
}
