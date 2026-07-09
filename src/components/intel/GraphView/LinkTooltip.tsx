"use client";

import { useCallback } from "react";
import Link from "next/link";
import { dropsToXrp } from "@/lib/xrpl-helpers";
import type { GraphEdge } from "./index";

function fmtAmount(amount: number, currency: string): string {
  if (currency === "XRP") {
    const xrp = Number(dropsToXrp(amount));
    if (xrp >= 1_000_000) return `${(xrp / 1_000_000).toFixed(1)}M XRP`;
    if (xrp >= 1_000) return `${(xrp / 1_000).toFixed(1)}K XRP`;
    return `${xrp.toFixed(1)} XRP`;
  }
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M ${currency}`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K ${currency}`;
  return `${amount.toFixed(2)} ${currency}`;
}

function truncAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

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

export default function LinkTooltip({
  edge,
  screenX,
  screenY,
}: {
  edge: GraphEdge;
  screenX: number;
  screenY: number;
}) {
  const refCb = useCallback((el: HTMLDivElement | null) => {
    if (el) clamp(el, screenX, screenY);
  }, [screenX, screenY]);

  const date = new Date(edge.timestamp * 1000).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div
      ref={refCb}
      className="fixed z-50 rounded-lg border border-elevated bg-surface shadow-card px-3 py-2 space-y-1"
      style={{ left: screenX + 12, top: screenY - 8 }}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-cell text-muted">{truncAddr(edge.from)}</span>
        <span className="text-muted">→</span>
        <span className="font-mono text-cell text-muted">{truncAddr(edge.to)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-cell font-medium text-primary">{edge.amount != null ? fmtAmount(edge.amount, edge.currency) : "—"}</span>
        <span className={`rounded-tag px-2 py-0.5 font-mono text-tag font-medium ${edge.type === "PAYMENT" ? "bg-brand/10 text-brand" : "bg-chart-emerald/10 text-chart-emerald"}`}>
          {edge.type === "PAYMENT" ? "PAY" : "DEX"}
        </span>
        <span className="font-mono text-label text-muted">{date}</span>
      </div>
      <Link href={`/tx/${edge.tx_hash}`} className="block font-mono text-label text-brand hover:underline truncate">
        {edge.tx_hash.slice(0, 16)}... ↗
      </Link>
    </div>
  );
}
