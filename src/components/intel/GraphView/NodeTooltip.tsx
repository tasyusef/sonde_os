"use client";

import { useCallback } from "react";
import Link from "next/link";
import { dropsToXrp } from "@/lib/xrpl-helpers";
import type { GraphEdge } from "./index";

function fmtXrp(drops: number): string {
  const xrp = Number(dropsToXrp(drops));
  if (xrp >= 1_000_000) return `${(xrp / 1_000_000).toFixed(1)}M`;
  if (xrp >= 1_000) return `${(xrp / 1_000).toFixed(1)}K`;
  return xrp.toFixed(1);
}

function fmtAmount(amount: number, currency: string): string {
  if (currency === "XRP") return `${fmtXrp(amount)} XRP`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M ${currency}`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K ${currency}`;
  return `${amount.toFixed(2)} ${currency}`;
}

function truncAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Clamp tooltip position so it stays within the viewport. */
function clamp(el: HTMLElement, sx: number, sy: number) {
  const rect = el.getBoundingClientRect();
  let left = sx + 12;
  let top = sy - 8;
  if (left + rect.width > window.innerWidth - 8) left = sx - rect.width - 12;
  if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
  if (top < 8) top = 8;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

const MAX_EDGES = 5;

export default function NodeTooltip({
  address,
  screenX,
  screenY,
  edges,
  onSetActiveAccount,
}: {
  address: string;
  screenX: number;
  screenY: number;
  edges: GraphEdge[];
  onSetActiveAccount: (addr: string) => void;
}) {
  const refCb = useCallback((el: HTMLDivElement | null) => {
    if (el) clamp(el, screenX, screenY);
  }, [screenX, screenY]);

  const related = edges.filter((e) => e.from === address || e.to === address);
  const xrpRelated = related.filter((e) => e.currency === "XRP" && e.amount != null);
  const inDrops = xrpRelated.filter((e) => e.to === address).reduce((s, e) => s + e.amount, 0);
  const outDrops = xrpRelated.filter((e) => e.from === address).reduce((s, e) => s + e.amount, 0);
  const shown = related.slice(0, MAX_EDGES);
  const remaining = related.length - shown.length;

  return (
    <div
      ref={refCb}
      className="fixed z-50 w-72 rounded-lg border border-elevated bg-surface shadow-card"
      style={{ left: screenX + 12, top: screenY - 8 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-3 py-2">
        <button onClick={() => onSetActiveAccount(address)} className="font-mono text-cell font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
          {truncAddr(address)}
        </button>
        <Link href={`/account/${address}`} className="font-mono text-label text-muted hover:text-brand transition-colors">
          View ↗
        </Link>
      </div>

      {/* Summary */}
      <div className="border-b border-elevated px-3 py-2">
        <span className="font-mono text-label text-muted">
          {related.length} transaction{related.length !== 1 ? "s" : ""}
          {(inDrops > 0 || outDrops > 0) && " · "}
          {inDrops > 0 && <span className="text-success">+{fmtXrp(inDrops)}</span>}
          {inDrops > 0 && outDrops > 0 && " / "}
          {outDrops > 0 && <span className="text-error">-{fmtXrp(outDrops)}</span>}
          {" XRP"}
        </span>
      </div>

      {/* Edge list */}
      {shown.length > 0 && (
        <div className="max-h-48 overflow-y-auto">
          {shown.map((e) => {
            const isOut = e.from === address;
            const counterparty = isOut ? e.to : e.from;
            return (
              <div key={e.tx_hash} className="px-3 py-1.5 border-b border-elevated last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-label text-muted shrink-0">{isOut ? "→" : "←"}</span>
                  <button onClick={() => onSetActiveAccount(counterparty)} className="font-mono text-cell text-brand hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
                    {truncAddr(counterparty)}
                  </button>
                  <span className="ml-auto font-mono text-cell font-medium text-primary shrink-0">
                    {e.amount != null ? fmtAmount(e.amount, e.currency) : "—"}
                  </span>
                  <span className={`rounded-tag px-2 py-0.5 font-mono text-tag font-medium shrink-0 ${e.type === "PAYMENT" ? "bg-brand/10 text-brand" : "bg-chart-emerald/10 text-chart-emerald"}`}>
                    {e.type === "PAYMENT" ? "PAY" : "DEX"}
                  </span>
                </div>
                <Link href={`/tx/${e.tx_hash}`} className="mt-0.5 block font-mono text-label text-muted hover:text-brand transition-colors truncate">
                  {e.tx_hash.slice(0, 12)}...{e.tx_hash.slice(-4)} ↗
                </Link>
              </div>
            );
          })}
          {remaining > 0 && (
            <div className="px-3 py-1.5">
              <span className="font-mono text-label text-muted">(+ {remaining} more)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
