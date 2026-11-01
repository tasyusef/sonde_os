import type { NFTHistoryTransaction } from "@/types/nft";
import {
  dropsToXrp,
  formatDate,
  formatDateCompact,
  decodeCurrency,
} from "@/lib/xrpl-helpers";
import TypeTag from "@/components/shared/TypeTag";
import AddressLink from "@/components/shared/AddressLink";
import HashLink from "@/components/shared/HashLink";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import Section from "@/components/shared/Section";
import { cell, thClass } from "@/lib/table";

function formatAmount(
  amount?: string | { value: string; currency: string; issuer: string },
): string | null {
  if (!amount) return null;
  if (typeof amount === "string") return `${dropsToXrp(amount)} XRP`;
  return `${parseFloat(amount.value).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${decodeCurrency(amount.currency)}`;
}


/**
 * NFT transaction history table. Mobile-first per CLAUDE.md design
 * rule: `table-fixed` + `<colgroup>` for predictable widths. Pattern
 * matches `HoldingsList`:
 *
 *   Mobile (<sm): Type (+ Account, date) | Amount (+ Hash)
 *   sm:           Type (+ date) | Account | Amount | Hash
 *   lg+:          Type | Account | Amount | Date | Hash
 *
 * The type tag ("NFTokenCreateOffer" is the longest) needs about
 * 150px, so Type takes the flexible width and Account only becomes a
 * column once there is room for both. Hidden columns hide their
 * `<col>`, `<th>` and `<td>` together so the rest keep their widths.
 *
 * Shows 15 rows, then Load More.
 */
export default function NFTHistoryTable({
  transactions,
  note,
  className,
}: {
  transactions: NFTHistoryTransaction[];
  /** A caveat under the table, e.g. that older entries exist. */
  note?: string | null;
  className?: string;
}) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(transactions.length);

  if (transactions.length === 0) {
    return (
      <Section title="History" className={className}>
        <p className="font-mono text-cell text-muted">No transactions yet.</p>
      </Section>
    );
  }

  return (
    <Section title="History" count={transactions.length} note={note} className={className}>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-auto" />
          <col className="hidden sm:table-column sm:w-[24%] lg:w-[18%]" />
          <col className="w-[40%] sm:w-[22%] lg:w-[16%]" />
          <col className="hidden lg:table-column lg:w-[24%]" />
          <col className="hidden sm:table-column sm:w-[22%] lg:w-[16%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>
              Type
            </th>
            <th
              scope="col"
              className={`${thClass} hidden text-left sm:table-cell`}
            >
              Account
            </th>
            <th scope="col" className={`${thClass} text-right max-sm:pr-0`}>
              Amount
            </th>
            <th
              scope="col"
              className={`${thClass} hidden text-left lg:table-cell`}
            >
              Date
            </th>
            <th
              scope="col"
              className={`${thClass} hidden text-left sm:table-cell`}
            >
              Hash
            </th>
          </tr>
        </thead>
        <tbody ref={listRef}>
          {transactions.slice(0, visible).map((tx, i) => {
            const amount = formatAmount(tx.amount);
            const dateStr = tx.date ? formatDate(tx.date) : null;
            const compactDateStr = tx.date ? formatDateCompact(tx.date) : null;
            return (
              <tr
                key={`${tx.hash}-${i}`}
                className="border-b border-line last:border-b-0 hover:bg-row-hover"
              >
                <td className={`${cell} align-top`}>
                  {/* Only truncates near 320px wide, where even the
                      flexible column is narrower than the longest tag.
                      `align-top` drops the baseline gap that
                      `overflow-hidden` adds under an inline-block. */}
                  <TypeTag txType={tx.type} className="max-w-full truncate align-top" />
                  {/* Mobile-only Account; its own column from sm. */}
                  <span className="mt-1 block sm:hidden">
                    <AddressLink address={tx.account} />
                  </span>
                  {/* Compact date (no seconds or "UTC") until the Date
                      column appears at lg. */}
                  {compactDateStr && (
                    <span className="mt-0.5 block whitespace-nowrap font-mono text-tag text-muted lg:hidden">
                      {compactDateStr}
                    </span>
                  )}
                </td>
                <td className={`${cell} hidden align-top sm:table-cell`}>
                  <AddressLink address={tx.account} />
                </td>
                <td className={`${cell} break-words text-right align-top font-mono text-cell tabular-nums text-primary max-sm:pr-0`}>
                  {amount ?? <span className="text-muted">&mdash;</span>}
                  {/* Mobile-only hash; its own column from sm. */}
                  <span className="mt-0.5 block text-tag sm:hidden">
                    <HashLink hash={tx.hash} />
                  </span>
                </td>
                <td className={`${cell} hidden align-top font-mono text-cell text-primary lg:table-cell`}>
                  {dateStr ?? "—"}
                </td>
                <td className={`${cell} hidden align-top sm:table-cell`}>
                  <HashLink hash={tx.hash} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <LoadMoreFooter
          visible={visible}
          total={transactions.length}
          onLoadMore={loadMore}
          onShowAll={showAll}
          label="transactions"
        />
      )}
    </Section>
  );
}

export { NFTHistoryTable };
