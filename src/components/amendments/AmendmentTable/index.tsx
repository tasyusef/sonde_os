import AmendmentName from "@/components/amendments/AmendmentName";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import Section from "@/components/shared/Section";
import type { AmendmentInfo } from "@/types/amendments";
import { cell, thClass } from "@/lib/table";

/**
 * Amendments that aren't being voted on: enabled ones with the day they
 * activated (`dated`), or open ones nobody votes for. Shows 15 rows,
 * then Load More.
 */
export default function AmendmentTable({
  title,
  rows,
  dated = false,
  note,
}: {
  title: string;
  rows: AmendmentInfo[];
  dated?: boolean;
  note?: string;
}) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(rows.length);

  return (
    <Section title={title} count={rows.length} note={note}>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-auto" />
          {dated && <col className="w-28" />}
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>
              Amendment
            </th>
            {dated && (
              <th scope="col" className={`${thClass} text-right`}>
                Enabled
              </th>
            )}
          </tr>
        </thead>
        <tbody ref={listRef}>
          {rows.slice(0, visible).map((row) => (
            <tr key={row.hash} className="border-b border-line last:border-b-0 hover:bg-row-hover">
              <td className={`${cell} align-top`}>
                <AmendmentName amendment={row} />
              </td>
              {dated && (
                <td className={`${cell} text-right align-top font-mono text-cell tabular-nums text-muted`}>
                  {/* UTC day; the registry stores bare dates. */}
                  {row.enabledAt ? <time dateTime={row.enabledAt}>{row.enabledAt.slice(0, 10)}</time> : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <LoadMoreFooter
          visible={visible}
          total={rows.length}
          onLoadMore={loadMore}
          onShowAll={showAll}
          label="amendments"
        />
      )}
    </Section>
  );
}

export { AmendmentTable };
