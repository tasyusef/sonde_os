"use client";

import AddressLink from "@/components/shared/AddressLink";
import { decodeCurrency } from "@/lib/xrpl-helpers";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";

export interface TrustLine {
  LedgerEntryType: string;
  Balance: { value: string; currency: string; issuer: string };
  HighLimit: { value: string; currency: string; issuer: string };
  LowLimit: { value: string; currency: string; issuer: string };
}

/** AMM LP tokens encode as 40-char hex starting with "03". */
function isLpCurrency(currency: string): boolean {
  return currency.length === 40 && currency.startsWith("03");
}

export default function TrustLineList({
  trustLines,
  address,
}: {
  trustLines: TrustLine[];
  address: string;
}) {
  const { visible, hasMore, loadMore, showAll } = usePagination(
    trustLines.length,
    15,
  );
  const pageRows = trustLines.slice(0, visible);

  if (trustLines.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">No trust lines found</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
              Currency
            </th>
            <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
              Issuer
            </th>
            <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
              Balance
            </th>
            <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
              Limit
            </th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((tl, i) => {
            const isHigh = tl.HighLimit.issuer === address;
            const issuer = isHigh ? tl.LowLimit.issuer : tl.HighLimit.issuer;
            const currency = tl.Balance.currency;
            const balance = parseFloat(tl.Balance?.value ?? "0") || 0;
            const displayBalance = isHigh ? -balance : balance;
            const limit = isHigh
              ? (parseFloat(tl.HighLimit?.value ?? "0") || 0)
              : (parseFloat(tl.LowLimit?.value ?? "0") || 0);

            const isLp = isLpCurrency(currency);
            const displayName = isLp ? "LP Token" : decodeCurrency(currency);

            return (
              <tr
                key={`${currency}-${issuer}-${i}`}
                className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
              >
                <td className="px-4 py-row">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-cell font-medium text-primary">
                      {displayName}
                    </span>
                    {isLp && (
                      <span className="rounded-tag bg-tx-amm/10 px-1.5 py-0.5 font-display text-micro font-medium uppercase tracking-header text-tx-amm">
                        LP
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-row">
                  <AddressLink address={issuer} />
                </td>
                <td className="px-4 py-row text-right">
                  <span
                    className={`font-mono text-cell tabular-nums ${
                      displayBalance > 0 ? "text-success" : displayBalance < 0 ? "text-error" : "text-muted"
                    }`}
                  >
                    {displayBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </span>
                </td>
                <td className="px-4 py-row text-right font-mono text-cell text-secondary tabular-nums">
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
    </div>
  );
}
