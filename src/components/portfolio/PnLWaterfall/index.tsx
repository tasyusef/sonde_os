"use client";

import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TokenEntry {
  name: string;
  pnlUsd: number | null;
  valueUsd: number;
}

interface TokensResponse {
  tokens: TokenEntry[];
}

export default function PnLWaterfall() {
  const { data } = useSWR<TokensResponse>(
    CACHE_KEYS.portfolioTokens(),
    fetcher,
  );

  if (!data) return null;

  // Top 5 gainers + top 5 losers
  const allWithPnl = data.tokens
    .filter((t) => t.pnlUsd != null && t.valueUsd > 0)
    .sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0));

  const gainers = allWithPnl.filter((t) => (t.pnlUsd ?? 0) >= 0).slice(0, 5);
  const losers = allWithPnl.filter((t) => (t.pnlUsd ?? 0) < 0).slice(-5);
  const withPnl = [...gainers, ...losers];

  if (withPnl.length === 0) return null;

  const maxAbsPnl = Math.max(...withPnl.map((t) => Math.abs(t.pnlUsd ?? 0)), 1);
  const totalPnl = withPnl.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0);

  return (
    <div className="flex flex-col rounded-2xl shadow-card bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          PnL by Token
        </span>
        <span
          className={cn(
            "font-mono text-label font-semibold tabular-nums",
            totalPnl >= 0 ? "text-success" : "text-error",
          )}
        >
          {totalPnl >= 0 ? "+" : ""}
          {formatVolume(totalPnl)}
        </span>
      </div>

      {/* Bars */}
      <div className="space-y-2 px-4 py-4">
        {withPnl.map((t) => {
          const pnl = t.pnlUsd ?? 0;
          const positive = pnl >= 0;
          const barWidth = (Math.abs(pnl) / maxAbsPnl) * 100;

          return (
            <div key={t.name} className="flex items-center gap-2 sm:gap-3">
              {/* Token name */}
              <span className="w-12 shrink-0 truncate font-mono text-cell font-medium text-primary sm:w-20">
                {t.name}
              </span>

              {/* Bar container — split at center */}
              <div className="relative flex h-5 flex-1 items-center">
                {/* Center line */}
                <div className="absolute left-1/2 top-0 h-full w-px bg-elevated" />

                {positive ? (
                  /* Right-growing bar */
                  <div className="absolute left-1/2 h-full" style={{ width: `${barWidth / 2}%` }}>
                    <div
                      className="h-full rounded-r-sm bg-success/60 transition-all duration-300"
                      style={{ width: "100%" }}
                    />
                  </div>
                ) : (
                  /* Left-growing bar */
                  <div
                    className="absolute right-1/2 h-full"
                    style={{ width: `${barWidth / 2}%` }}
                  >
                    <div
                      className="ml-auto h-full rounded-l-sm bg-error/60 transition-all duration-300"
                      style={{ width: "100%" }}
                    />
                  </div>
                )}
              </div>

              {/* Value */}
              <span
                className={cn(
                  "w-14 shrink-0 text-right font-mono text-cell font-medium tabular-nums sm:w-20",
                  positive ? "text-success" : "text-error",
                )}
              >
                {positive ? "+" : ""}
                {formatVolume(pnl)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
