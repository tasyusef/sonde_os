"use client";

import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TokenEntry {
  currency: string;
  issuer: string;
  name: string;
  valueUsd: number;
  pnlUsd: number | null;
  pnlPct: number | null;
}

interface TokensResponse {
  tokens: TokenEntry[];
}

interface TokenBreakdownEntry {
  currency: string;
  issuer: string;
  usd: number;
}

interface HistoryWithTokens {
  earliestTokenBreakdown?: TokenBreakdownEntry[];
}

function formatPct(pct: number): string {
  const prefix = pct >= 0 ? "+" : "";
  return Math.abs(pct) >= 100
    ? `${prefix}${pct.toFixed(0)}%`
    : `${prefix}${pct.toFixed(1)}%`;
}

function MoverCard({
  label,
  token,
  change24h,
  accent,
}: {
  label: string;
  token: TokenEntry | null;
  change24h: number | null;
  accent: "success" | "error";
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-elevated px-4 py-3">
      <span className="font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </span>
      {token ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-mono text-ui font-medium text-primary">
              {token.name}
            </span>
            <div className="flex shrink-0 items-baseline gap-2">
              <span className="font-mono text-cell tabular-nums text-secondary">
                {formatVolume(token.valueUsd)}
              </span>
              {token.pnlPct != null && (
                <span
                  className={cn(
                    "font-mono text-label font-semibold tabular-nums",
                    `text-${accent}`,
                  )}
                >
                  {formatPct(token.pnlPct)}
                </span>
              )}
            </div>
          </div>
          {change24h != null && (
            <span
              className={cn(
                "font-mono text-tag tabular-nums",
                change24h >= 0 ? "text-success/70" : "text-error/70",
              )}
            >
              24h: {formatPct(change24h)}
            </span>
          )}
        </>
      ) : (
        <span className="font-mono text-cell text-muted">—</span>
      )}
    </div>
  );
}

export default function TopMovers() {
  const { data } = useSWR<TokensResponse>(
    CACHE_KEYS.portfolioTokens(),
    fetcher,
  );

  const { data: historyData } = useSWR<HistoryWithTokens>(
    CACHE_KEYS.portfolioHistoryWithTokens("24h"),
    fetcher,
  );

  if (!data) return null;

  // Build 24h-ago price map
  const priorMap = new Map<string, number>();
  if (historyData?.earliestTokenBreakdown) {
    for (const t of historyData.earliestTokenBreakdown) {
      priorMap.set(`${t.currency}:${t.issuer}`, t.usd);
    }
  }

  // Only consider tokens with cost basis data
  const withPnl = data.tokens.filter(
    (t) => t.pnlPct != null && t.valueUsd > 0,
  );

  if (withPnl.length === 0) return null;

  const sorted = [...withPnl].sort(
    (a, b) => (a.pnlPct ?? 0) - (b.pnlPct ?? 0),
  );

  const topGainer = sorted[sorted.length - 1];
  const topLoser = sorted[0];

  const showLoser = topLoser && (topLoser.pnlPct ?? 0) < 0;
  const showGainer = topGainer && (topGainer.pnlPct ?? 0) > 0;

  if (!showGainer && !showLoser) return null;

  function get24hChange(token: TokenEntry | null): number | null {
    if (!token) return null;
    const key = `${token.currency}:${token.issuer}`;
    const prior = priorMap.get(key);
    if (prior == null || prior === 0) return null;
    return ((token.valueUsd - prior) / prior) * 100;
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      <MoverCard
        label="Top Gainer"
        token={showGainer ? topGainer : null}
        change24h={showGainer ? get24hChange(topGainer) : null}
        accent="success"
      />
      <MoverCard
        label="Top Loser"
        token={showLoser ? topLoser : null}
        change24h={showLoser ? get24hChange(topLoser) : null}
        accent="error"
      />
    </div>
  );
}
