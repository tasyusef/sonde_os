"use client";

import Link from "next/link";
import TokenIcon from "@/components/tokens/TokenIcon";
import type { AMMListItem } from "@/lib/amm-data";
import type { SortField, SortDir } from "@/components/tokens/AMMList";

/* ——— Format helpers ——— */

function formatXrp(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

/** XRPL `trading_fee` is in 1/100,000 units: 1000 = 1%. */
function formatFee(units: number): string {
  return `${(units / 1000).toFixed(3)}%`;
}

function SortArrow({
  field,
  sortField,
  sortDir,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
}) {
  if (field !== sortField) return <span className="ml-1 text-muted/40">↓</span>;
  return <span className="ml-1 text-brand">{sortDir === "desc" ? "↓" : "↑"}</span>;
}

/* ——— Table ——— */

/**
 * Pure renderer for the AMM pool listing. Card wrapper, header bar,
 * filter input, and pagination state all live in the parent `AMMList`
 * component — this one just paints rows. Mirrors the TokenTable
 * (renderer) / TokenSearch (state owner) split so both market tabs
 * share the same separation of concerns.
 */
export default function AMMTable({
  pools,
  sortField,
  sortDir,
  onSort,
}: {
  pools: AMMListItem[];
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  if (pools.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="font-mono text-body text-muted">No AMM pools found</p>
      </div>
    );
  }

  const thBase =
    "font-display text-label font-medium uppercase tracking-header text-muted";
  const headerProps = (field: SortField) => ({
    role: "button" as const,
    tabIndex: 0,
    onClick: () => onSort(field),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSort(field);
      }
    },
    className:
      "cursor-pointer select-none hover:text-secondary transition-colors",
  });

  return (
    <>
      {/* ── Mobile list ── */}
      <div className="sm:hidden">
        {pools.map((pool, i) => (
          <Link
            key={`m-${pool.account}`}
            href={`/markets/${encodeURIComponent(pool.currency)}/${pool.issuer}`}
            className="flex items-center gap-3 border-b border-elevated px-4 py-3 transition-colors hover:bg-row-hover last:border-b-0"
          >
            <span className="shrink-0 font-mono text-cell tabular-nums text-muted">
              {i + 1}
            </span>
            <TokenIcon src={pool.icon} currency={pool.currencyDisplay} />
            <div className="min-w-0 flex-1">
              <span className="block truncate font-mono text-cell font-bold text-brand">
                XRP / {pool.currencyDisplay}
              </span>
              {pool.issuerName && (
                <span className="block truncate font-mono text-tag text-muted">
                  {pool.issuerName}
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="font-mono text-cell tabular-nums text-primary">
                {formatXrp(pool.tvlXrp)} XRP
              </span>
              <span className="font-mono text-tag tabular-nums text-muted">
                {formatFee(pool.tradingFee)}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full table-auto md:table-fixed">
          <thead>
            <tr className="border-b border-elevated">
              <th
                scope="col"
                className={`w-10 px-3 py-row text-left ${thBase} md:px-4`}
              >
                #
              </th>
              <th
                scope="col"
                className={`px-3 py-row text-left ${thBase} md:w-[28%] md:px-4`}
              >
                Pool
              </th>
              <th
                scope="col"
                className={`hidden px-4 py-row text-left ${thBase} md:table-cell`}
              >
                Issuer
              </th>
              <th
                scope="col"
                aria-sort={
                  sortField === "tvl"
                    ? sortDir === "desc"
                      ? "descending"
                      : "ascending"
                    : "none"
                }
                className={`px-3 py-row text-right ${thBase} md:px-4 md:text-left`}
              >
                <span {...headerProps("tvl")}>
                  TVL (XRP)
                  <SortArrow field="tvl" sortField={sortField} sortDir={sortDir} />
                </span>
              </th>
              <th
                scope="col"
                aria-sort={
                  sortField === "fee"
                    ? sortDir === "desc"
                      ? "descending"
                      : "ascending"
                    : "none"
                }
                className={`px-3 py-row text-right ${thBase} md:px-4 md:text-left`}
              >
                <span {...headerProps("fee")}>
                  Fee
                  <SortArrow field="fee" sortField={sortField} sortDir={sortDir} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pools.map((pool, i) => {
              const tokenHref = `/markets/${encodeURIComponent(pool.currency)}/${pool.issuer}`;
              return (
                <tr
                  key={pool.account}
                  className="border-b border-elevated transition-colors hover:bg-row-hover"
                >
                  <td className="px-3 py-row font-mono text-body text-muted tabular-nums md:px-4">
                    {i + 1}
                  </td>
                  <td className="px-3 py-row md:px-4">
                    <Link href={tokenHref} className="flex items-center gap-2.5">
                      <TokenIcon
                        src={pool.icon}
                        currency={pool.currencyDisplay}
                      />
                      <span className="font-mono text-cell font-bold text-brand">
                        XRP / {pool.currencyDisplay}
                      </span>
                    </Link>
                  </td>
                  <td className="hidden px-4 py-row md:table-cell">
                    {pool.issuerName ? (
                      <span className="font-mono text-cell text-secondary">
                        {pool.issuerName}
                      </span>
                    ) : (
                      <span className="font-mono text-cell text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-row text-right font-mono text-cell tabular-nums text-secondary md:px-4 md:text-left">
                    {formatXrp(pool.tvlXrp)}
                  </td>
                  <td className="px-3 py-row text-right font-mono text-cell tabular-nums text-secondary md:px-4 md:text-left">
                    {formatFee(pool.tradingFee)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
