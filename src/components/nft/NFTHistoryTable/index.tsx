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

function formatAmount(
  amount?: string | { value: string; currency: string; issuer: string },
): string | null {
  if (!amount) return null;
  if (typeof amount === "string") return `${dropsToXrp(amount)} XRP`;
  return `${parseFloat(amount.value).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${decodeCurrency(amount.currency)}`;
}

const thClass =
  "px-4 py-row font-display text-label font-medium uppercase tracking-header text-muted";

/**
 * NFT transaction history table. Mobile-first per CLAUDE.md design
 * rule: `table-fixed` + `<colgroup>` for predictable widths. Below
 * `md` the Date and Hash columns hide as columns and surface as
 * secondary lines under the Type and Account cells respectively —
 * users on phones still see when each tx happened and can tap into
 * the tx hash. Pattern matches `HoldingsList` / `ActivationsList`.
 *
 * Pre-redesign this was 5 columns inside `overflow-x-auto`, which
 * meant on phones the table either horizontal-scrolled or columns
 * silently vanished depending on breakpoint. Both fail the "don't
 * ship a 4+-column table that just overflows on phones" rule.
 */
export default function NFTHistoryTable({
  transactions,
}: {
  transactions: NFTHistoryTransaction[];
}) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-6 text-center shadow-card">
        <p className="font-mono text-body text-muted">No transaction history</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Transaction History
        </span>
        <span className="ml-2 font-mono text-label text-muted">
          {transactions.length}
        </span>
      </div>

      <table className="w-full table-fixed">
        <colgroup>
          {/* Mobile: Type pill is the longest piece of content
               ("NFTokenCancelOffer" = 18 chars + pill padding), so
               its column needs ~40% to fit without overflowing into
               Account. Tightens at sm + md once Date / Hash columns
               appear. Account flexes (carries mobile-folded Hash).
               Amount is right-aligned, fixed-width. */}
          <col className="w-[40%] sm:w-[20%] md:w-[14%]" />
          <col className="w-auto" />
          <col className="w-[28%] sm:w-[22%] md:w-[18%]" />
          <col className="hidden md:table-column md:w-[16%]" />
          <col className="hidden md:table-column md:w-[16%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className={`${thClass} text-left`}>
              Type
            </th>
            <th scope="col" className={`${thClass} text-left`}>
              Account
            </th>
            <th scope="col" className={`${thClass} text-right`}>
              Amount
            </th>
            <th
              scope="col"
              className={`${thClass} hidden text-left md:table-cell`}
            >
              Date
            </th>
            <th
              scope="col"
              className={`${thClass} hidden text-left md:table-cell`}
            >
              Hash
            </th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx, i) => {
            const amount = formatAmount(tx.amount);
            const dateStr = tx.date ? formatDate(tx.date) : null;
            const compactDateStr = tx.date ? formatDateCompact(tx.date) : null;
            return (
              <tr
                key={`${tx.hash}-${i}`}
                className="border-b border-elevated transition-colors last:border-b-0 hover:bg-row-hover"
              >
                <td className="px-4 py-row align-top">
                  <TypeTag txType={tx.type} />
                  {/* Mobile-only inline date — Date column hides
                      under md so we surface it as a secondary line
                      on the Type cell. Compact format (drops seconds
                      + "UTC" suffix) so it fits on a single line
                      inside the narrow mobile cell. */}
                  {compactDateStr && (
                    <span className="mt-1 block whitespace-nowrap font-mono text-tag text-muted md:hidden">
                      {compactDateStr}
                    </span>
                  )}
                </td>
                <td className="px-4 py-row align-top">
                  <AddressLink address={tx.account} />
                  {/* Mobile-only inline hash — folds under the
                      address on narrow viewports so the hash stays
                      reachable without a horizontal-scroll table. */}
                  <span className="mt-0.5 block font-mono text-tag text-muted md:hidden">
                    <HashLink hash={tx.hash} />
                  </span>
                </td>
                <td className="px-4 py-row text-right align-top font-mono text-cell tabular-nums text-primary">
                  {amount ?? <span className="text-muted">&mdash;</span>}
                </td>
                <td className="hidden px-4 py-row align-top font-mono text-cell text-secondary md:table-cell">
                  {dateStr ?? "—"}
                </td>
                <td className="hidden px-4 py-row align-top md:table-cell">
                  <HashLink hash={tx.hash} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { NFTHistoryTable };
