import AddressLink from "@/components/shared/AddressLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import ListNotice from "@/components/shared/ListNotice";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { cell, thClass } from "@/lib/table";
import { formatDate, formatDateCompact } from "@/lib/xrpl-helpers";

export interface Escrow {
  Account: string;
  Destination: string;
  Amount: string;
  Condition?: string;
  CancelAfter?: number;
  FinishAfter?: number;
  PreviousTxnID: string;
}

/**
 * Escrows held by or sent to an account. Mobile-first, same pattern as
 * `HoldingsList`:
 *
 *   Mobile (<sm):  From (+ → Destination) | Amount (+ expiry, conditional)
 *   sm:            From | Destination | Amount (+ conditional) | Expiry
 *   lg+:           From | Destination | Amount | Condition | Expiry
 *
 * Hidden columns hide their `<col>`, `<th>` and `<td>` together so the
 * remaining columns keep their widths. Folded values sit under the cell
 * they belong with, so nothing is clipped at any width.
 */
export default function EscrowList({ escrows }: { escrows: Escrow[] }) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(escrows.length, 15);

  if (escrows.length === 0) {
    return <ListNotice message="No escrows found." />;
  }

  return (
    <>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-auto" />
          <col className="hidden sm:table-column sm:w-[24%] lg:w-[19%]" />
          <col className="w-[44%] sm:w-[22%] lg:w-[17%]" />
          <col className="hidden lg:table-column lg:w-[13%]" />
          <col className="hidden sm:table-column sm:w-[24%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>
              <span className="sm:hidden">From / To</span>
              <span className="hidden sm:inline">From</span>
            </th>
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              Destination
            </th>
            <th scope="col" className={`${thClass} text-right max-sm:pr-0`}>
              <span className="sm:hidden">Amount / Expiry</span>
              <span className="hidden sm:inline">Amount</span>
            </th>
            <th scope="col" className={`${thClass} hidden text-left lg:table-cell`}>
              Condition
            </th>
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              Expiry
            </th>
          </tr>
        </thead>
        <tbody ref={listRef}>
          {escrows.slice(0, visible).map((escrow, i) => {
            const expiry = escrow.CancelAfter || escrow.FinishAfter;
            return (
              <tr
                key={escrow.PreviousTxnID || i}
                className="border-b border-line last:border-b-0 hover:bg-row-hover"
              >
                <td className={`${cell} align-top`}>
                  <AddressLink address={escrow.Account} />
                  {/* Mobile-only Destination, folded under From. */}
                  <span className="mt-0.5 block font-mono text-tag text-muted sm:hidden">
                    <span aria-hidden="true">→ </span>
                    <span className="sr-only">To </span>
                    <AddressLink address={escrow.Destination} />
                  </span>
                </td>
                <td className={`${cell} hidden align-top sm:table-cell`}>
                  <AddressLink address={escrow.Destination} />
                </td>
                <td className={`${cell} break-words text-right align-top max-sm:pr-0`}>
                  <AmountDisplay drops={escrow.Amount} />
                  {/* Mobile-only expiry: compact so it fits one line. */}
                  <span className="mt-0.5 block font-mono text-tag text-muted sm:hidden">
                    {expiry ? formatDateCompact(expiry) : "—"}
                  </span>
                  {/* Condition folds here until its own column appears at lg. */}
                  {escrow.Condition && (
                    <span className="mt-0.5 block font-mono text-tag text-muted lg:hidden">
                      Conditional
                    </span>
                  )}
                </td>
                <td className={`${cell} hidden align-top font-mono text-cell text-primary lg:table-cell`}>
                  {escrow.Condition ? "Yes" : "No"}
                </td>
                <td className={`${cell} hidden align-top font-mono text-cell text-primary sm:table-cell`}>
                  {expiry ? formatDate(expiry) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <LoadMoreFooter
          visible={visible}
          total={escrows.length}
          onLoadMore={loadMore}
          onShowAll={showAll}
          label="escrows"
        />
      )}
    </>
  );
}
