"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/* ── Types ── */

export interface LeaderboardRow {
  address: string;
  compositeScore: string;
  totalPnlXrp: string | null;
  winRate?: string | null;
  totalTrades?: number | null;
  tokensTraded?: number | null;
  sharpeRatio?: string | null;
  washTradingFlag?: boolean | null;
  scoredAt: string;
}

type SortField = "compositeScore" | "totalPnlXrp" | "winRate" | "tokensTraded" | "sharpeRatio";
type SortDir = "asc" | "desc";

interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  sortField?: SortField;
  sortDir?: SortDir;
  onSort?: (field: SortField) => void;
  startRank?: number;
}

/* ── Helpers ── */

// Tier thresholds calibrated for the recalibrated scorer (top ~64,
// p95 ~42, p90 ~32). 50+ = top ~5% = "Smart Money", 30+ = top ~12% =
// "Emerging".
function scoreColor(score: number): string {
  if (score >= 50) return "text-success";
  if (score >= 30) return "text-brand";
  return "text-muted";
}

function scoreLabel(score: number): string {
  if (score >= 50) return "Smart Money";
  if (score >= 30) return "Emerging";
  return "";
}

function formatPnl(pnl: string | null): string {
  if (!pnl) return "--";
  const n = Number(pnl);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const formatted = abs >= 1_000_000
    ? `${(abs / 1_000_000).toFixed(1)}M`
    : abs >= 1_000
      ? `${(abs / 1_000).toFixed(1)}K`
      : abs.toFixed(0);
  return n > 0 ? `+${formatted}` : `-${formatted}`;
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function SortArrow({ field, activeField, dir }: { field: SortField; activeField?: SortField; dir?: SortDir }) {
  if (field !== activeField) return null;
  return (
    <span className="ml-0.5 text-brand" aria-hidden="true">
      {dir === "asc" ? "\u2191" : "\u2193"}
    </span>
  );
}

/** Sortable column header \u2014 keyboard-accessible button inside a <th>.
 *  The previous click-only `<th>` had no focus ring and no Enter/Space
 *  activation, leaving keyboard users unable to sort. */
function SortableTh({
  field,
  label,
  sortField,
  sortDir,
  onSort,
  thClassName,
  align = "right",
}: {
  field: SortField;
  label: string;
  sortField?: SortField;
  sortDir?: SortDir;
  onSort: (field: SortField) => void;
  thClassName?: string;
  align?: "right" | "left";
}) {
  const isActive = sortField === field;
  return (
    <th
      scope="col"
      aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "px-3 sm:px-4 py-3 font-display text-label font-medium uppercase tracking-header text-muted",
        align === "right" ? "text-right" : "text-left",
        thClassName,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="-mx-1 -my-1 inline-flex items-center gap-0.5 rounded px-1 py-1 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        {label}
        <SortArrow field={field} activeField={sortField} dir={sortDir} />
      </button>
    </th>
  );
}

/* ── Component ── */

export default function LeaderboardTable({
  rows,
  sortField,
  sortDir,
  onSort,
  startRank = 1,
}: LeaderboardTableProps) {
  function headerClick(field: SortField) {
    if (onSort) onSort(field);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full" role="table">
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className="px-3 sm:px-4 py-3 text-left font-display text-label font-medium uppercase tracking-header text-muted w-8 sm:w-14">
              #
            </th>
            <th scope="col" className="px-3 sm:px-4 py-3 text-left font-display text-label font-medium uppercase tracking-header text-muted">
              Address
            </th>
            <SortableTh field="compositeScore" label="Score" sortField={sortField} sortDir={sortDir} onSort={headerClick} />
            <SortableTh field="totalPnlXrp" label="PnL" sortField={sortField} sortDir={sortDir} onSort={headerClick} />
            <SortableTh field="winRate" label="Win Rate" sortField={sortField} sortDir={sortDir} onSort={headerClick} thClassName="hidden sm:table-cell" />
            <SortableTh field="tokensTraded" label="Tokens" sortField={sortField} sortDir={sortDir} onSort={headerClick} thClassName="hidden md:table-cell" />
            <SortableTh field="sharpeRatio" label="Sharpe" sortField={sortField} sortDir={sortDir} onSort={headerClick} thClassName="hidden md:table-cell" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const score = Number(row.compositeScore);
            const rank = startRank + i;
            const pnlNum = Number(row.totalPnlXrp) || 0;

            return (
              <tr
                key={row.address}
                className="relative border-b border-elevated last:border-b-0 transition-colors cursor-pointer hover:bg-elevated/50 focus-within:bg-elevated/50"
              >
                <td className="px-3 sm:px-4 py-3 font-mono text-cell text-muted">{rank}</td>
                <td className="px-3 sm:px-4 py-3">
                  <Link
                    href={`/smart-money/${row.address}`}
                    className="font-mono text-cell text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 after:absolute after:inset-0 after:content-['']"
                  >
                    {formatAddress(row.address)}
                  </Link>
                  {row.washTradingFlag && (
                    <span className="relative ml-1.5 rounded-tag bg-error/10 px-1 py-0.5 font-mono text-tag text-error" title="Wash trading detected">
                      WASH
                    </span>
                  )}
                </td>
                <td className="px-3 sm:px-4 py-3 text-right">
                  <span className={cn("font-mono text-cell font-medium", scoreColor(score))}>
                    {score.toFixed(0)}
                  </span>
                  {scoreLabel(score) && (
                    <span className={cn("ml-1.5 hidden sm:inline font-mono text-tag", scoreColor(score))}>
                      {scoreLabel(score)}
                    </span>
                  )}
                </td>
                <td className={cn(
                  "px-3 sm:px-4 py-3 text-right font-mono text-cell",
                  pnlNum > 0 ? "text-success" : pnlNum < 0 ? "text-error" : "text-muted",
                )}>
                  {formatPnl(row.totalPnlXrp)}
                </td>
                <td className="hidden sm:table-cell px-4 py-3 text-right font-mono text-cell text-primary">
                  {row.winRate ? `${Number(row.winRate).toFixed(0)}%` : "--"}
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-right font-mono text-cell text-primary">
                  {row.tokensTraded ?? "--"}
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-right font-mono text-cell text-primary">
                  {row.sharpeRatio ? Number(row.sharpeRatio).toFixed(2) : "--"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="px-4 py-12 text-center font-body text-ui text-muted">
          No scored wallets yet. The scoring pipeline runs daily at 2am UTC.
        </p>
      )}
    </div>
  );
}
