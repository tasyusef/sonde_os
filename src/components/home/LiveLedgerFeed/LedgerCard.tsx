"use client";

import { useMemo, useState, useEffect, memo } from "react";
import Link from "next/link";
import { XRPL_EPOCH, dropsToXrp, getTypeFamily, getTypeColor } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";
import type { TxSummary } from "@/types/live-data";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(rippleTime: number): string {
  const now = Math.floor(Date.now() / 1000);
  const ledgerUnix = rippleTime + XRPL_EPOCH;
  const diff = now - ledgerUnix;
  if (diff < 2) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function useTimeAgo(rippleTime: number): string {
  const [label, setLabel] = useState(() => timeAgo(rippleTime));
  useEffect(() => {
    const id = setInterval(() => setLabel(timeAgo(rippleTime)), 1000);
    return () => clearInterval(id);
  }, [rippleTime]);
  return label;
}

interface FamilyShare {
  family: string;
  color: string;
  count: number;
}

function buildFamilyShares(txSummaries: TxSummary[]): FamilyShare[] {
  const counts = new Map<string, { color: string; count: number }>();
  for (const tx of txSummaries) {
    const family = getTypeFamily(tx.type);
    const existing = counts.get(family);
    if (existing) {
      existing.count++;
    } else {
      counts.set(family, { color: getTypeColor(tx.type), count: 1 });
    }
  }
  return Array.from(counts.entries())
    .map(([family, { color, count }]) => ({ family, color, count }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface LedgerCardProps {
  ledgerIndex: number;
  ledgerTime: number;
  txnCount: number;
  txSummaries?: TxSummary[];
  totalFees?: string;
  horizontal?: boolean;
}

/**
 * Per-ledger card for the live feed. Single fixed-height row showing
 * the ledger #, age, tx count, fee burned, plus a proportional
 * stacked bar of tx-type families and a legend.
 *
 * Pre-2026-05-10 the body was a per-tx 16×16 dot grid that grew
 * vertically with tx count — cards ranged 80–250px tall, breaking
 * vertical rhythm in the live feed (Tim's "looks like shit"
 * complaint). Replaced with a single 6px proportional bar so every
 * card is the same compact height regardless of ledger size. The
 * granular per-tx hover-tooltip went away with the dots; per-family
 * counts surface in the legend instead.
 */
function LedgerCardInner({
  ledgerIndex,
  ledgerTime,
  txnCount,
  txSummaries,
  totalFees,
  horizontal,
}: LedgerCardProps) {
  const families = useMemo(
    () => (txSummaries ? buildFamilyShares(txSummaries) : []),
    [txSummaries],
  );
  const total = families.reduce((s, f) => s + f.count, 0);

  const feeXrp = totalFees ? dropsToXrp(totalFees) : null;
  const relativeTime = useTimeAgo(ledgerTime);

  return (
    <div
      className={cn(
        "rounded-xl border border-elevated bg-surface shadow-card",
        horizontal && "w-[300px] shrink-0",
      )}
    >
      {/* Header row */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b border-elevated px-3 py-2",
          horizontal && "flex-col items-start gap-1",
        )}
      >
        <div className="flex items-center gap-2">
          <Link
            href={`/ledger/${ledgerIndex}`}
            className="font-mono text-ui font-medium text-brand transition-colors hover:text-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            #{ledgerIndex.toLocaleString()}
          </Link>
          <span className="font-mono text-tag text-muted">{relativeTime}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-tag tabular-nums text-primary">
            {txnCount} <span className="text-muted">txn{txnCount !== 1 ? "s" : ""}</span>
          </span>
          {feeXrp && (
            <span className="font-mono text-tag tabular-nums text-muted">
              {feeXrp} <span className="text-muted">XRP burned</span>
            </span>
          )}
        </div>
      </div>

      {/* Proportional family bar — always 6px tall, regardless of
           tx count. Each segment's width is proportional to its
           share of this ledger's transactions. Hover title surfaces
           per-family counts for sighted users. */}
      {families.length > 0 ? (
        <div className="px-3 py-3">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-elevated">
            {families.map((f) => (
              <div
                key={f.family}
                className="h-full"
                style={{
                  width: `${(f.count / total) * 100}%`,
                  backgroundColor: f.color,
                }}
                title={`${f.family}: ${f.count}`}
                aria-label={`${f.family}: ${f.count}`}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="px-3 py-3">
          <p className="text-center font-mono text-tag text-muted">
            No transaction data
          </p>
        </div>
      )}

      {/* Legend row — picks up the count info that disappeared with
           the dots. flex-wrap so it lays out nicely even when a
           ledger has 7+ tx families. */}
      {families.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-elevated px-3 py-1.5">
          {families.map((item) => (
            <div key={item.family} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-swatch"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span className="font-mono text-tag text-muted">{item.family}</span>
              <span className="font-mono text-tag tabular-nums text-muted/60">
                {item.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const LedgerCard = memo(LedgerCardInner);
export default LedgerCard;
