import { Link } from "react-router";
import AddressLink from "@/components/shared/AddressLink";
import { decodeCurrency } from "@/lib/xrpl-helpers";
import ListNotice from "@/components/shared/ListNotice";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { cell, thClass } from "@/lib/table";
import { isLpCurrency, tokenPath } from "@/lib/token-id";

export interface TrustLine {
  LedgerEntryType: string;
  Balance: { value: string; currency: string; issuer: string };
  HighLimit: { value: string; currency: string; issuer: string };
  LowLimit: { value: string; currency: string; issuer: string };
}

/**
 * Trust lines from the account's side. Mobile-first, same pattern as
 * `EscrowList`:
 *
 *   Mobile (<sm): Currency (+ Counterparty) | Balance (+ Limit)
 *   sm+:          Currency | Counterparty | Balance | Limit
 */
export default function TrustLineList({
  trustLines,
  address,
}: {
  trustLines: TrustLine[];
  address: string;
}) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(
    trustLines.length,
    15,
  );
  const pageRows = trustLines.slice(0, visible);

  if (trustLines.length === 0) {
    return <ListNotice message="No trust lines found." />;
  }

  return (
    <>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-auto" />
          <col className="hidden sm:table-column sm:w-[28%]" />
          <col className="w-[44%] sm:w-[22%]" />
          <col className="hidden sm:table-column sm:w-[22%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>
              <span className="sm:hidden">Currency / Counterparty</span>
              <span className="hidden sm:inline">Currency</span>
            </th>
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              Counterparty
            </th>
            <th scope="col" className={`${thClass} text-right max-sm:pr-0`}>
              <span className="sm:hidden">Balance / Limit</span>
              <span className="hidden sm:inline">Balance</span>
            </th>
            <th scope="col" className={`${thClass} hidden text-right sm:table-cell`}>
              Limit
            </th>
          </tr>
        </thead>
        <tbody ref={listRef}>
          {pageRows.map((tl, i) => {
            const isHigh = tl.HighLimit.issuer === address;
            const counterparty = isHigh ? tl.LowLimit.issuer : tl.HighLimit.issuer;
            const currency = tl.Balance.currency;
            const balance = parseFloat(tl.Balance?.value ?? "0") || 0;
            // `|| 0` turns the high side's -0 into 0.
            const displayBalance = (isHigh ? -balance : balance) || 0;
            const limit = isHigh
              ? (parseFloat(tl.HighLimit?.value ?? "0") || 0)
              : (parseFloat(tl.LowLimit?.value ?? "0") || 0);

            const isLp = isLpCurrency(currency);
            const displayName = isLp ? "LP Token" : decodeCurrency(currency);
            // The side that owes issues the token: the account, when it
            // owes or only the other side trusts it.
            const tokenIssuer = displayBalance < 0 || (displayBalance === 0 && limit === 0) ? address : counterparty;

            return (
              <tr
                key={`${currency}-${counterparty}-${i}`}
                className="border-b border-line last:border-b-0 hover:bg-row-hover"
              >
                <td className={`${cell} align-top`}>
                  <div className="flex items-center gap-2">
                    {isLp ? (
                      <span className="min-w-0 break-words font-mono text-cell font-medium text-primary">
                        {displayName}
                      </span>
                    ) : (
                      <Link
                        to={tokenPath({ kind: "iou", currency, issuer: tokenIssuer })}
                        className="link min-w-0 break-words font-mono text-cell font-medium text-primary"
                      >
                        {displayName}
                      </Link>
                    )}
                    {isLp && (
                      <span className="rounded-tag tag-amm px-1.5 py-0.5 font-display text-caps uppercase tracking-header">
                        LP
                      </span>
                    )}
                  </div>
                  {/* Mobile-only Counterparty; its own column from sm. */}
                  <span className="mt-0.5 block text-tag sm:hidden">
                    <span className="sr-only">Counterparty </span>
                    <AddressLink address={counterparty} />
                  </span>
                </td>
                <td className={`${cell} hidden align-top sm:table-cell`}>
                  <AddressLink address={counterparty} />
                </td>
                <td className={`${cell} break-words text-right align-top max-sm:pr-0`}>
                  <span
                    className={`font-mono text-cell tabular-nums ${
                      displayBalance > 0 ? "text-success" : displayBalance < 0 ? "text-error" : "text-muted"
                    }`}
                  >
                    {displayBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </span>
                  {/* Mobile-only Limit; its own column from sm. */}
                  <span className="mt-0.5 block font-mono text-tag tabular-nums text-muted sm:hidden">
                    <span className="sr-only">Limit </span>
                    {limit.toLocaleString()}
                  </span>
                </td>
                <td className={`${cell} hidden break-words text-right align-top font-mono text-cell text-primary tabular-nums sm:table-cell`}>
                  {limit.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <LoadMoreFooter
          visible={visible}
          total={trustLines.length}
          onLoadMore={loadMore}
          onShowAll={showAll}
          label="trust lines"
        />
      )}
    </>
  );
}
