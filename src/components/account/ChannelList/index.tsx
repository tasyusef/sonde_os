import AddressLink from "@/components/shared/AddressLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import ListNotice from "@/components/shared/ListNotice";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { cell, thClass } from "@/lib/table";
import { formatDate, formatDateCompact } from "@/lib/xrpl-helpers";

export interface Channel {
  Account: string;
  Destination: string;
  Amount: string;
  Balance: string;
  Expiration?: number;
  CancelAfter?: number;
  SettleDelay: number;
  PreviousTxnID: string;
}

/**
 * Payment channels the account funds. Mobile-first, same pattern as
 * `EscrowList`:
 *
 *   Mobile (<sm):  Destination (+ expiry) | Amount (+ claimed)
 *   sm:            Destination | Amount | Claimed | Expiry (+ settle delay)
 *   lg+:           Destination | Amount | Claimed | Settle Delay | Expiry
 *
 * `Balance` is what the channel has already paid out, so it's labelled
 * "Claimed": "Balance" reads as what's left.
 */
export default function ChannelList({ channels }: { channels: Channel[] }) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(channels.length, 15);

  if (channels.length === 0) {
    return <ListNotice message="No payment channels found." />;
  }

  return (
    <>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-auto" />
          <col className="w-[44%] sm:w-[22%] lg:w-[17%]" />
          <col className="hidden sm:table-column sm:w-[22%] lg:w-[17%]" />
          <col className="hidden lg:table-column lg:w-[14%]" />
          <col className="hidden sm:table-column sm:w-[24%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>
              <span className="sm:hidden">Destination / Expiry</span>
              <span className="hidden sm:inline">Destination</span>
            </th>
            <th scope="col" className={`${thClass} text-right max-sm:pr-0`}>
              <span className="sm:hidden">Amount / Claimed</span>
              <span className="hidden sm:inline">Amount</span>
            </th>
            <th scope="col" className={`${thClass} hidden text-right sm:table-cell`}>
              Claimed
            </th>
            <th scope="col" className={`${thClass} hidden text-right lg:table-cell`}>
              Settle Delay
            </th>
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              Expiry
            </th>
          </tr>
        </thead>
        <tbody ref={listRef}>
          {channels.slice(0, visible).map((ch, i) => {
            const expiry = ch.Expiration ?? ch.CancelAfter;
            const delay = `${ch.SettleDelay.toLocaleString()}s`;
            return (
              <tr
                key={ch.PreviousTxnID || i}
                className="border-b border-line last:border-b-0 hover:bg-row-hover"
              >
                <td className={`${cell} align-top`}>
                  <AddressLink address={ch.Destination} />
                  {/* Mobile-only expiry: compact so it fits one line. */}
                  <span className="mt-0.5 block font-mono text-tag text-muted sm:hidden">
                    {expiry ? formatDateCompact(expiry) : "No expiry"}
                  </span>
                </td>
                <td className={`${cell} break-words text-right align-top max-sm:pr-0`}>
                  <AmountDisplay drops={ch.Amount} />
                  <span className="mt-0.5 block font-mono text-tag text-muted sm:hidden">
                    <AmountDisplay drops={ch.Balance} className="text-tag text-muted" /> claimed
                  </span>
                </td>
                <td className={`${cell} hidden break-words text-right align-top sm:table-cell`}>
                  <AmountDisplay drops={ch.Balance} />
                </td>
                <td className={`${cell} hidden text-right align-top font-mono text-cell text-primary tabular-nums lg:table-cell`}>
                  {delay}
                </td>
                <td className={`${cell} hidden align-top font-mono text-cell text-primary sm:table-cell`}>
                  {expiry ? formatDate(expiry) : "—"}
                  {/* Settle delay folds here until its own column appears at lg. */}
                  <span className="mt-0.5 block text-tag text-muted lg:hidden">
                    {delay} settle delay
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <LoadMoreFooter
          visible={visible}
          total={channels.length}
          onLoadMore={loadMore}
          onShowAll={showAll}
          label="channels"
        />
      )}
    </>
  );
}
