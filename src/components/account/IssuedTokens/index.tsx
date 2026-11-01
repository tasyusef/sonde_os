import { Link } from "react-router";
import { decodeCurrency } from "@/lib/xrpl-helpers";
import TokenIcon from "@/components/shared/TokenIcon";
import ListNotice from "@/components/shared/ListNotice";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { cell, thClass } from "@/lib/table";
import { isLpCurrency, tokenPath } from "@/lib/token-id";

export interface IssuedToken {
  /** Raw XRPL currency code — 3-char or 40-char hex */
  currency: string;
  /** Outstanding obligation as a decimal string (from gateway_balances) */
  outstanding: string;
}

function formatSupply(value: string): string {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** The tokens `issuer` issued, each opening its token page. */
export default function IssuedTokens({ issuer, tokens }: { issuer: string; tokens: IssuedToken[] }) {
  const rows = tokens
    .filter((t) => !isLpCurrency(t.currency))
    .map((t) => ({ ...t, ticker: decodeCurrency(t.currency) }))
    .sort((a, b) => parseFloat(b.outstanding) - parseFloat(a.outstanding));

  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(rows.length, 15);
  const pageRows = rows.slice(0, visible);

  if (rows.length === 0) {
    return <ListNotice message="No tokens issued by this account." />;
  }

  return (
    <>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-auto" />
          <col className="hidden sm:table-column sm:w-[40%]" />
          <col className="w-[50%] sm:w-[30%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>Token</th>
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              Currency Code
            </th>
            <th scope="col" className={`${thClass} text-right`}>
              Outstanding Supply
            </th>
          </tr>
        </thead>
        <tbody ref={listRef}>
          {pageRows.map((row) => (
            <tr
              key={row.currency}
              className="border-b border-line last:border-b-0 hover:bg-row-hover"
            >
              <td className={cell}>
                <div className="flex items-center gap-2.5">
                  <TokenIcon
                    src={null}
                    currency={row.ticker}
                    size={28}
                    className="size-7 shrink-0"
                  />
                  <Link
                    to={tokenPath({ kind: "iou", currency: row.currency, issuer })}
                    className="link min-w-0 break-words font-mono text-cell font-medium text-primary"
                  >
                    {row.ticker}
                  </Link>
                </div>
              </td>
              <td className={`${cell} hidden sm:table-cell`}>
                <span className="block truncate font-mono text-tag text-muted">
                  {row.currency}
                </span>
              </td>
              <td className={`${cell} break-words text-right font-mono text-cell tabular-nums text-primary`}>
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
    </>
  );
}
