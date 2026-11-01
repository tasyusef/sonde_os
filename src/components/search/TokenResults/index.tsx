import { Link } from "react-router";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { cell, thClass } from "@/lib/table";
import { tokenId, tokenPath } from "@/lib/token-id";
import { formatListDate, type ListedToken } from "@/lib/token-list";
import { truncate } from "@/lib/xrpl-helpers";

/**
 * The tokens a text search matches, best first (`matchTokens`), with
 * who issued each, since a ticker alone doesn't say which of its copies
 * it is. Mobile-first:
 *
 *   mobile (<sm): Token (+ name, issuer) | Holders
 *   sm+:          Token (+ name) | Issuer (+ domain) | Holders
 */
export default function TokenResults({
  tokens,
  query,
  made,
}: {
  tokens: ListedToken[];
  query: string;
  made: string;
}) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(tokens.length, 25);

  return (
    <>
      <h1 className="font-display text-heading font-bold text-primary sm:text-title">Tokens</h1>
      <p className="mt-2 break-words font-mono text-cell text-muted">
        {tokens.length.toLocaleString()} {tokens.length === 1 ? "matches" : "match"} “{query}”
      </p>

      <table className="mt-6 w-full table-fixed">
        <colgroup>
          <col className="w-auto" />
          <col className="hidden sm:table-column sm:w-[40%]" />
          <col className="w-[30%] sm:w-[16%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>Token</th>
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>Issuer</th>
            <th scope="col" className={`${thClass} text-right`}>Holders</th>
          </tr>
        </thead>
        <tbody ref={listRef}>
          {tokens.slice(0, visible).map((t) => (
            <tr key={tokenId(t.ref)} className="border-b border-line last:border-b-0 hover:bg-row-hover">
              <td className={`${cell} align-top`}>
                <Link to={tokenPath(t.ref)} className="link break-words font-mono text-cell text-primary">
                  {t.ticker}
                </Link>
                {t.name && <span className="mt-0.5 block truncate font-mono text-label text-muted">{t.name}</span>}
                {/* Mobile-only issuer; its own column from sm. */}
                <span className="mt-0.5 block truncate font-mono text-label text-muted sm:hidden">
                  {t.issuerName ?? t.domain ?? truncate(t.issuer)}
                </span>
              </td>
              <td className={`${cell} hidden align-top sm:table-cell`}>
                <Link to={`/account/${t.issuer}`} className="link block truncate font-mono text-cell text-primary">
                  {t.issuerName ?? truncate(t.issuer)}
                </Link>
                {t.domain && <span className="mt-0.5 block truncate font-mono text-label text-muted">{t.domain}</span>}
              </td>
              <td className={`${cell} text-right align-top font-mono tabular-nums text-primary`}>
                {t.holders.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <LoadMoreFooter
          visible={visible}
          total={tokens.length}
          onLoadMore={loadMore}
          onShowAll={showAll}
          label="tokens"
        />
      )}

      <p className="mt-6 font-mono text-label leading-read-sm text-muted">
        The most-held tokens, from{" "}
        <a href="https://xrplmeta.org" target="_blank" rel="noopener noreferrer" className="link">
          XRPL Meta
        </a>
        , as of {formatListDate(made)}. Holder counts are theirs, from then.
      </p>
    </>
  );
}
