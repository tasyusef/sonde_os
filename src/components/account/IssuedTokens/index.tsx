"use client";

import Link from "next/link";
import { decodeCurrency } from "@/lib/xrpl-helpers";
import TokenIcon from "@/components/tokens/TokenIcon";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";

export interface IssuedToken {
  /** Raw XRPL currency code — 3-char or 40-char hex */
  currency: string;
  /** Outstanding obligation as a decimal string (from gateway_balances) */
  outstanding: string;
}

const thClass =
  "px-4 py-row font-display text-label font-medium uppercase tracking-header text-muted";

/** AMM LP tokens encode as 40-char hex starting with "03" — exclude them. */
function isLpCurrency(currency: string): boolean {
  return currency.length === 40 && currency.startsWith("03");
}

function formatSupply(value: string): string {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function IssuedTokens({
  tokens,
  issuer,
}: {
  tokens: IssuedToken[];
  issuer: string;
}) {
  const rows = tokens
    .filter((t) => !isLpCurrency(t.currency))
    .map((t) => ({ ...t, ticker: decodeCurrency(t.currency) }))
    .sort((a, b) => parseFloat(b.outstanding) - parseFloat(a.outstanding));

  const { visible, hasMore, loadMore, showAll } = usePagination(rows.length, 15);
  const pageRows = rows.slice(0, visible);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">
          No tokens issued by this account
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className={`${thClass} text-left`}>Token</th>
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              Currency Code
            </th>
            <th scope="col" className={`${thClass} text-right`}>
              Outstanding Supply
            </th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr
              key={row.currency}
              className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
            >
              <td className="px-4 py-row">
                <Link
                  href={`/markets/${row.currency}/${issuer}`}
                  className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded"
                >
                  <TokenIcon
                    src={null}
                    currency={row.ticker}
                    size={28}
                    className="size-7 shrink-0"
                  />
                  <span className="font-mono text-cell font-medium text-brand">
                    {row.ticker}
                  </span>
                </Link>
              </td>
              <td className="hidden px-4 py-row sm:table-cell">
                <span className="block max-w-[260px] truncate font-mono text-tag text-muted">
                  {row.currency}
                </span>
              </td>
              <td className="px-4 py-row text-right font-mono text-cell tabular-nums text-primary">
                {formatSupply(row.outstanding)}
              </td>
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
          label="tokens"
        />
      )}
    </div>
  );
}
