import Link from "next/link";
import { type TokenListItem, type VolumePeriod } from "@/lib/token-types";
import type { SortField, SortDir } from "@/components/tokens/TokenSearch";
import TokenRow from "@/components/tokens/TokenRow";
import TokenIcon from "@/components/tokens/TokenIcon";

function formatPrice(price: number): string {
  if (price <= 0) return "0";
  // Collapse anything below a micro-XRP into a "<0.000001" indicator
  // rather than exponent notation — memecoin prices that round out to
  // 2.59e-11 XRP are common and scientific notation made the table
  // unreadable.
  if (price < 0.000001) return "<0.000001";
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

function SortArrow({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <span className="ml-1 text-muted/40">&darr;</span>;
  return <span className="ml-1 text-brand">{sortDir === "desc" ? "\u2193" : "\u2191"}</span>;
}

export default function TokenTable({
  tokens,
  period = "24h",
  sortField,
  sortDir,
  onSort,
}: {
  tokens: TokenListItem[];
  period?: VolumePeriod;
  sortField?: SortField;
  sortDir?: SortDir;
  onSort?: (field: SortField) => void;
}) {
  if (tokens.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="font-mono text-body text-muted">No tokens found</p>
      </div>
    );
  }

  const thBase = "font-display text-label font-medium uppercase tracking-header text-muted";
  const sortable = onSort != null;

  function headerProps(field: SortField) {
    if (!sortable) return {};
    return {
      role: "button" as const,
      tabIndex: 0,
      onClick: () => onSort!(field),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort!(field);
        }
      },
      className: "cursor-pointer select-none hover:text-secondary transition-colors",
    };
  }

  return (
    <div>
      {/* ── Mobile list ── */}
      <div className="sm:hidden">
        {tokens.map((token, i) => {
          const { meta, metrics: m } = token;
          const price = m.price != null ? `${formatPrice(m.price)} XRP` : "—";
          return (
            <Link
              key={`m-${token.currency}-${token.issuer}`}
              href={`/markets/${encodeURIComponent(token.currency)}/${token.issuer}`}
              className="flex items-center gap-3 border-b border-elevated px-4 py-3 transition-colors hover:bg-row-hover last:border-b-0"
            >
              <span className="shrink-0 font-mono text-cell tabular-nums text-muted">
                {i + 1}
              </span>
              <TokenIcon src={meta.icon} currency={token.currencyDisplay} />
              <div className="min-w-0 flex-1">
                <span
                  className={`block truncate text-cell font-bold text-brand ${
                    meta.name ? "font-display" : "font-mono"
                  }`}
                >
                  {meta.name ?? token.currencyDisplay}
                </span>
                {meta.name && meta.name.toLowerCase() !== token.currencyDisplay.toLowerCase() && (
                  <span className="font-mono text-tag text-muted">{token.currencyDisplay}</span>
                )}
              </div>
              <span className="shrink-0 text-right font-mono text-cell tabular-nums text-primary">
                {price}
              </span>
            </Link>
          );
        })}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full table-auto md:table-fixed">
          <thead>
            <tr className="border-b border-elevated">
              <th scope="col" className={`w-10 px-3 py-row text-left ${thBase} md:px-4`}>
                #
              </th>
              <th scope="col" className={`px-3 py-row text-left ${thBase} md:w-[18%] md:px-4`}>
                Token
              </th>
              <th scope="col" className={`hidden px-4 py-row text-left ${thBase} md:table-cell`}>
                Issuer
              </th>
              <th scope="col" className={`px-3 py-row text-right ${thBase} md:px-4 md:text-left`}>
                <span {...headerProps("price")}>
                  Price
                  {sortField && <SortArrow field="price" sortField={sortField} sortDir={sortDir!} />}
                </span>
              </th>
              <th scope="col" className={`hidden px-4 py-row text-left ${thBase} sm:table-cell`}>
                <span {...headerProps("marketcap")}>
                  Market Cap
                  {sortField && <SortArrow field="marketcap" sortField={sortField} sortDir={sortDir!} />}
                </span>
              </th>
              <th scope="col" className={`hidden px-4 py-row text-left ${thBase} lg:table-cell`}>
                <span {...headerProps("volume")}>
                  Volume {period === "7d" ? "7D" : "24H"}
                  {sortField && <SortArrow field="volume" sortField={sortField} sortDir={sortDir!} />}
                </span>
              </th>
              <th scope="col" className={`hidden px-4 py-row text-left ${thBase} md:table-cell`}>
                <span {...headerProps("holders")}>
                  Holders
                  {sortField && <SortArrow field="holders" sortField={sortField} sortDir={sortDir!} />}
                </span>
              </th>
              <th scope="col" className={`hidden px-4 py-row text-left ${thBase} md:table-cell`}>
                <span {...headerProps("trustlines")}>
                  Trust Lines
                  {sortField && <SortArrow field="trustlines" sortField={sortField} sortDir={sortDir!} />}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token, i) => (
              <TokenRow
                key={`${token.currency}-${token.issuer}`}
                token={token}
                rank={i + 1}
                period={period}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
