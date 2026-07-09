"use client";

import { useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TableData } from "@/types/intel";

/**
 * Tabular renderer for non-chartable multi-row results. Mono-typed
 * rendering with right-aligned numerics, address detection (links to
 * /account/[address]), and column sorting + CSV copy on desktop.
 *
 * Mobile renders as a card stack (label/value pairs) so we don't need
 * horizontal scroll — the same data, presented vertically. Sort + CSV
 * affordances are desktop-only since they don't make sense in cards.
 */

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const HASH_RE = /^[A-F0-9]{64}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** Past ~12 rows the table starts to push the answer below the fold;
 *  cap the desktop viewport so the user can scan without scrolling
 *  the entire page. Internal scroll engages above this height. */
const MAX_HEIGHT_PX = 480;

type SortDir = "asc" | "desc" | null;

function isNumeric(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function fmtNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M";
  if (abs >= 10_000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs > 0 && abs < 0.01) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatCell(value: unknown): React.ReactNode {
  if (value == null) return <span className="text-muted">—</span>;
  if (isNumeric(value)) return <span className="tabular-nums">{fmtNum(value)}</span>;
  if (typeof value === "bigint") return <span className="tabular-nums">{value.toLocaleString()}</span>;

  const s = String(value);
  if (ADDRESS_RE.test(s)) {
    const truncated = `${s.slice(0, 6)}…${s.slice(-4)}`;
    return (
      <a
        href={`/account/${s}`}
        className="text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
      >
        {truncated}
      </a>
    );
  }
  if (HASH_RE.test(s)) {
    const truncated = `${s.slice(0, 8)}…${s.slice(-6)}`;
    return (
      <a
        href={`/tx/${s}`}
        className="text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
      >
        {truncated}
      </a>
    );
  }
  if (ISO_DATE_RE.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  return s;
}

function isRightAlignedColumn(rows: Record<string, unknown>[], key: string): boolean {
  // Right-align if every non-null sample is numeric
  for (const r of rows.slice(0, 5)) {
    const v = r[key];
    if (v == null) continue;
    if (typeof v !== "number" && typeof v !== "bigint") return false;
  }
  return true;
}

/** Pick the next sort direction in the toggle cycle: null → asc → desc → null. */
function nextSortDir(current: SortDir, sameKey: boolean): SortDir {
  if (!sameKey) return "asc";
  if (current === "asc") return "desc";
  if (current === "desc") return null;
  return "asc";
}

/** Build a CSV string from the table. Quotes values that contain
 *  commas, quotes, or newlines per RFC 4180 (the actual standard, not
 *  the loose "split on comma" that breaks on the first address with
 *  weird chars). */
function toCsv(table: TableData): string {
  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = table.columns.map((c) => escape(c.label)).join(",");
  const lines = table.rows.map((r) =>
    table.columns.map((c) => escape(r[c.key])).join(","),
  );
  return [header, ...lines].join("\n");
}

export default function TableRenderer({ table }: { table: TableData }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [copied, setCopied] = useState(false);

  const sortedRows = useMemo(() => {
    if (!sortKey || !sortDir) return table.rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...table.rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nullish always sinks to the bottom regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // Numeric vs string-aware compare.
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [table.rows, sortKey, sortDir]);

  function handleSort(key: string) {
    const sameKey = key === sortKey;
    const next = nextSortDir(sortDir, sameKey);
    setSortDir(next);
    setSortKey(next === null ? null : key);
  }

  async function handleCopyCsv() {
    try {
      await navigator.clipboard.writeText(toCsv(table));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts or older browsers.
      // Silently no-op rather than throwing into the chat answer area.
    }
  }

  // Tall tables get internal scroll; short tables keep their natural height.
  const enableMaxHeight = table.rows.length > 12;

  return (
    <div className="-mx-1">
      {/* Mobile: card stack — one card per row, label/value pairs stacked.
          No sort / CSV affordances; both make less sense in a vertical
          card layout where you can't see all rows at once anyway. */}
      <div className="space-y-2 md:hidden">
        {table.rows.map((row, i) => (
          <div
            key={i}
            className="rounded-xl border border-elevated bg-bg/30 p-3"
          >
            <dl className="space-y-1.5">
              {table.columns.map((col) => (
                <div
                  key={col.key}
                  className="flex items-baseline justify-between gap-3"
                >
                  <dt className="shrink-0 font-display text-tag uppercase tracking-header text-muted">
                    {col.label}
                  </dt>
                  <dd className="text-right font-mono text-cell text-primary">
                    {formatCell(row[col.key])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {/* Desktop: real table with sortable headers + CSV copy. */}
      <div className="hidden rounded-xl border border-elevated md:block">
        {/* Header strip — copy CSV affordance, only shown for tables that
            are big enough to want it (at least a few rows of real data). */}
        {table.rows.length >= 3 && (
          <div className="flex items-center justify-between border-b border-elevated px-3 py-2">
            <span className="font-display text-tag uppercase tracking-header text-muted">
              {table.rows.length} rows
            </span>
            <button
              type="button"
              onClick={handleCopyCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-elevated bg-elevated px-2 py-1 font-mono text-tag text-muted transition-colors hover:border-brand/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              aria-label={copied ? "CSV copied to clipboard" : "Copy table as CSV"}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-success" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" aria-hidden="true" />
                  <span>Copy CSV</span>
                </>
              )}
            </button>
          </div>
        )}

        <div
          className={cn("overflow-x-auto", enableMaxHeight && "overflow-y-auto")}
          style={enableMaxHeight ? { maxHeight: MAX_HEIGHT_PX } : undefined}
        >
          <table>
            <thead className="sticky top-0 z-10 bg-bg/95 backdrop-blur-sm">
              <tr className="border-b border-elevated">
                {table.columns.map((col) => {
                  const right = isRightAlignedColumn(table.rows, col.key);
                  const active = sortKey === col.key && sortDir !== null;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      className={cn(
                        "whitespace-nowrap px-3 py-2 font-display text-tag uppercase tracking-header",
                        right ? "text-right" : "text-left",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className={cn(
                          "inline-flex items-baseline gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm",
                          active ? "text-primary" : "text-muted hover:text-primary",
                          right && "flex-row-reverse",
                        )}
                        aria-label={`Sort by ${col.label}${
                          active
                            ? sortDir === "asc"
                              ? " ascending (current)"
                              : " descending (current)"
                            : ""
                        }`}
                      >
                        <span>{col.label}</span>
                        <SortIndicator active={active} dir={sortDir} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr key={i} className="border-b border-elevated last:border-b-0">
                  {table.columns.map((col) => {
                    const right = isRightAlignedColumn(table.rows, col.key);
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "whitespace-nowrap px-3 py-2 font-mono text-cell text-primary",
                          right ? "text-right" : "text-left",
                        )}
                      >
                        {formatCell(row[col.key])}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Sort indicator chevron. Faded triangle when inactive, filled brand
 *  when active. Direction arrow flips with sortDir. */
function SortIndicator({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    // Inactive — faded double-arrow that hints "sortable."
    return (
      <span aria-hidden="true" className="font-mono text-tag text-muted/40">
        ↕
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="font-mono text-tag text-brand">
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
}
