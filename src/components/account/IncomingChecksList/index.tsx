import AddressLink from "@/components/shared/AddressLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import { decodeCurrency, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import ListNotice from "@/components/shared/ListNotice";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { cell, thClass } from "@/lib/table";

export interface IncomingCheck {
  /** Sender of the check (owes the funds). */
  Account: string;
  /** Destination of the check — should be the viewing account. */
  Destination: string;
  /** Maximum amount that can be cashed. XRP drops as string, IOU as object. */
  SendMax: string | { value: string; currency: string; issuer: string };
  /** Optional XRPL expiration (seconds since 2000-01-01 UTC). */
  Expiration?: number;
  /** Ledger entry index — used as the React key. */
  index?: string;
}

/**
 * IncomingChecksList — Check ledger entries where this account is the
 * Destination. Rendered inside OffersTab → Incoming.
 *
 * Mobile-first per CLAUDE.md:
 *   - Mobile (<sm): two columns. From (with expiration stacked below
 *     as text-tag muted), and Amount right-aligned.
 *   - Desktop (sm+): three columns — From | Max Amount | Expires.
 */
export default function IncomingChecksList({
  checks,
}: {
  checks: IncomingCheck[];
}) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(
    checks.length,
    15,
  );
  const pageChecks = checks.slice(0, visible);

  if (checks.length === 0) {
    return <ListNotice message="No checks received." />;
  }

  return (
    <>
      <table className="w-full table-fixed">
        <colgroup>
          {/* From — primary, takes remaining width */}
          <col className="w-auto" />
          {/* Mobile: Amount only. Desktop: Max Amount column. */}
          <col className="w-[40%] sm:w-[26%]" />
          {/* Expires — sm+ only */}
          <col className="hidden sm:table-column sm:w-[20%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>
              From
            </th>
            <th
              scope="col"
              className={`${thClass} text-right max-sm:pr-0 sm:text-left`}
            >
              <span className="sm:hidden">Amount</span>
              <span className="hidden sm:inline">Max Amount</span>
            </th>
            <th
              scope="col"
              className={`${thClass} hidden text-right sm:table-cell`}
            >
              Expires
            </th>
          </tr>
        </thead>
        <tbody ref={listRef}>
          {pageChecks.map((check, i) => {
            const expiry = formatExpiry(check.Expiration);
            return (
              <tr
                key={check.index ?? i}
                className="border-b border-line last:border-b-0 hover:bg-row-hover"
              >
                {/* From + mobile-only expiration beneath */}
                <td className={cell}>
                  <AddressLink address={check.Account} chars={5} />
                  <span className="mt-0.5 block font-mono text-tag text-muted sm:hidden">
                    {expiry}
                  </span>
                </td>
                {/* Amount */}
                <td className={`${cell} text-right max-sm:pr-0 sm:text-left`}>
                  <CheckAmount sendMax={check.SendMax} />
                </td>
                {/* Expires — sm+ only */}
                <td className={`${cell} hidden text-right font-mono text-cell text-muted sm:table-cell`}>
                  {expiry}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <LoadMoreFooter
          visible={visible}
          total={checks.length}
          onLoadMore={loadMore}
          onShowAll={showAll}
          label="checks"
        />
      )}
    </>
  );
}

function CheckAmount({ sendMax }: { sendMax: IncomingCheck["SendMax"] }) {
  if (typeof sendMax === "string") {
    return <AmountDisplay drops={sendMax} />;
  }
  return (
    <span className="font-mono text-cell tabular-nums">
      {parseFloat(sendMax.value).toLocaleString(undefined, {
        maximumFractionDigits: 6,
      })}{" "}
      {decodeCurrency(sendMax.currency)}
    </span>
  );
}

function formatExpiry(expiration: number | undefined): string {
  if (!expiration) return "—";
  const unixMs = (expiration + XRPL_EPOCH) * 1000;
  if (unixMs < Date.now()) return "Expired";
  const date = new Date(unixMs);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
