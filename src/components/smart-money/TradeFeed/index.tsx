"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { cn } from "@/lib/utils";
import { decodeCurrency } from "@/lib/xrpl-helpers";
import Button from "@/components/shared/Button";

/* ── Types ── */

interface Trade {
  txHash: string;
  timestamp: string;
  wallet: string;
  score: number;
  direction: "buy" | "sell";
  baseCurrency: string;
  baseIssuer: string;
  baseAmount: number;
  quoteCurrency: string;
  price: number;
  xrpVolume: number;
}

interface FeedResponse {
  trades: Trade[];
  total: number;
  totalInWindow?: number;
  hasMore?: boolean;
  window?: WindowKey;
}

type DirectionFilter = "all" | "buy" | "sell";
type WindowKey = "1h" | "24h" | "7d";

const WINDOW_OPTIONS: { value: WindowKey; label: string }[] = [
  { value: "1h", label: "1H" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
];

const PAGE_SIZE = 20;

const WINDOW_LABEL: Record<WindowKey, string> = {
  "1h": "hour",
  "24h": "24 hours",
  "7d": "7 days",
};

/* ── Helpers ── */

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Decode an XRPL currency code for display. 3-char tickers pass through;
 * 40-char hex decodes to ASCII (bwif, FARM, …). If decoding yields no
 * printable characters (binary codes like BTC↔XRP paired against an IOU
 * with a weird hex) we fall back to a truncated hex so we never dump 40
 * raw hex chars into a narrow mobile cell.
 */
function formatCurrency(currency: string): string {
  const decoded = decodeCurrency(currency);
  if (decoded === currency && /^[A-F0-9]{40}$/i.test(currency)) {
    return `${currency.slice(0, 4)}…${currency.slice(-4)}`;
  }
  return decoded;
}

function scoreColor(score: number): string {
  // Tier thresholds match the rest of the smart-money UI under the
  // recalibrated scorer: 50+ = top tier, 30+ = mid tier.
  if (score >= 50) return "text-success";
  if (score >= 30) return "text-brand";
  return "text-muted";
}

/* ── Component ── */

export default function TradeFeed() {
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [timeWindow, setTimeWindow] = useState<WindowKey>("24h");
  const [offset, setOffset] = useState(0);

  // Filter changes reset pagination in their onClick handlers below,
  // not via a useEffect, so we don't run afoul of the React Compiler's
  // set-state-in-effect rule.
  const changeDirection = (d: DirectionFilter) => {
    setDirection(d);
    setOffset(0);
  };
  const changeTimeWindow = (w: WindowKey) => {
    setTimeWindow(w);
    setOffset(0);
  };

  const dirParam = direction !== "all" ? `&direction=${direction}` : "";
  const pageLimit = offset > 0 ? offset + PAGE_SIZE : PAGE_SIZE;
  const { data, isLoading } = useSWR<FeedResponse>(
    `/api/smart-money/feed?window=${timeWindow}&limit=${pageLimit}${dirParam}`,
    fetcher,
    {
      refreshInterval: offset === 0 ? 30_000 : 0,
      dedupingInterval: 10_000,
      revalidateOnFocus: false,
      keepPreviousData: true,
    },
  );

  const trades = data?.trades ?? [];
  const totalInWindow = data?.totalInWindow ?? trades.length;
  const hasMore = trades.length < totalInWindow;

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
      {/* Header */}
      <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            Live Feed
          </span>
          <p className="mt-0.5 font-mono text-cell font-medium text-muted">
            {isLoading && trades.length === 0
              ? "Loading…"
              : `${trades.length}${hasMore ? `+` : ""} ${trades.length === 1 ? "trade" : "trades"} in the last ${WINDOW_LABEL[timeWindow]}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Window toggle */}
          <div
            role="radiogroup"
            aria-label="Trade window"
            className="flex shrink-0 items-center rounded-full border border-elevated bg-elevated p-0.5"
          >
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w.value}
                role="radio"
                aria-checked={timeWindow === w.value}
                onClick={() => changeTimeWindow(w.value)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 font-mono text-label font-medium uppercase tracking-pill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                  timeWindow === w.value
                    ? "bg-surface text-brand shadow-sm"
                    : "text-muted hover:text-secondary",
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
          {/* Direction filter */}
          <div
            role="radiogroup"
            aria-label="Trade side"
            className="flex shrink-0 items-center rounded-full border border-elevated bg-elevated p-0.5"
          >
            {(["all", "buy", "sell"] as const).map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={direction === d}
                onClick={() => changeDirection(d)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 font-mono text-label font-medium uppercase tracking-pill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                  direction === d
                    ? d === "buy"
                      ? "bg-surface text-success shadow-sm"
                      : d === "sell"
                        ? "bg-surface text-error shadow-sm"
                        : "bg-surface text-brand shadow-sm"
                    : "text-muted hover:text-secondary",
                )}
              >
                {d === "all" ? "All" : d === "buy" ? "Buys" : "Sells"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 border-b border-elevated px-4 py-3.5">
              <div className="h-4 w-12 animate-pulse rounded bg-elevated" />
              <div className="h-4 w-24 animate-pulse rounded bg-elevated" />
              <div className="ml-auto h-4 w-10 animate-pulse rounded bg-elevated" />
              <div className="h-4 w-16 animate-pulse rounded bg-elevated" />
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {!isLoading && trades.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full sm:min-w-[600px]" role="table">
            <thead>
              <tr className="border-b border-elevated">
                <th scope="col" className="px-4 py-3 text-left font-display text-label font-medium uppercase tracking-header text-muted">Time</th>
                <th scope="col" className="px-4 py-3 text-left font-display text-label font-medium uppercase tracking-header text-muted">Wallet</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 text-right font-display text-label font-medium uppercase tracking-header text-muted">Score</th>
                <th scope="col" className="px-4 py-3 text-center font-display text-label font-medium uppercase tracking-header text-muted">Side</th>
                <th scope="col" className="px-4 py-3 text-left font-display text-label font-medium uppercase tracking-header text-muted">Token</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 text-right font-display text-label font-medium uppercase tracking-header text-muted">Amount</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.txHash} className="border-b border-elevated last:border-b-0 hover:bg-elevated/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-cell text-muted">{timeAgo(t.timestamp)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/smart-money/${t.wallet}`}
                      className="font-mono text-cell text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                    >
                      {formatAddress(t.wallet)}
                    </Link>
                  </td>
                  <td className={cn("hidden sm:table-cell px-4 py-3 text-right font-mono text-cell font-medium", scoreColor(t.score))}>
                    {t.score.toFixed(0)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      "rounded-tag px-1.5 py-0.5 font-mono text-tag font-semibold uppercase",
                      t.direction === "buy" ? "bg-success/10 text-success" : "bg-error/10 text-error",
                    )}>
                      {t.direction}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-cell text-primary">
                    <span className="inline-block max-w-[10ch] truncate align-middle">
                      {formatCurrency(t.baseCurrency)}
                    </span>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-right font-mono text-cell text-primary">{formatAmount(t.baseAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Show more — only when more data is available */}
          {hasMore && (
            <div className="flex justify-center border-t border-elevated px-4 py-4">
              <Button
                onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
                loading={isLoading}
                variant="outline"
                size="md"
                className="rounded-full"
              >
                {isLoading ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && trades.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16">
          <p className="font-body text-ui text-muted">
            No smart money trades in the last {WINDOW_LABEL[timeWindow]}.
          </p>
          <p className="font-body text-cell text-muted">
            {timeWindow === "1h"
              ? "Try expanding the window to 24H or 7D."
              : "The feed auto-refreshes every 30 seconds."}
          </p>
        </div>
      )}
    </div>
  );
}
