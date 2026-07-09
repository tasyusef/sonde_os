"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { decodeCurrency } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";
import type { TokenVolumeRanking, RankingMeta } from "@/lib/db-queries";

/* ————————————————————————————————————————————
   Top Trading Pairs — in-page analytics card.

   Ranks XRPL token pairs by XRP volume over the selected period. Bar
   width = each pair's volume relative to the biggest pair in the set.
   Layout mirrors the Top Movers card (TopGainers24h) for visual
   consistency across the analytics surfaces: fixed-width pair name +
   flex-bar with overlaid value + fixed-width secondary metric.
   ———————————————————————————————————————————— */

type Period = "24h" | "7d" | "30d";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

function pairLabel(r: TokenVolumeRanking): string {
  const base = r.currency === "XRP" ? "XRP" : decodeCurrency(r.currency);
  const quote = r.pairCurrency === "XRP" ? "XRP" : decodeCurrency(r.pairCurrency);
  return `${base}/${quote}`;
}

function formatVolume(xrp: number): string {
  if (xrp >= 1_000_000) return `${(xrp / 1_000_000).toFixed(2)}M`;
  if (xrp >= 1_000) return `${(xrp / 1_000).toFixed(1)}K`;
  return xrp.toFixed(0);
}

function formatTrades(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

interface PairRow {
  pair: string;
  volume: number;
  trades: number;
}

export default function TopTradingPairs() {
  const [period, setPeriod] = useState<Period>("24h");

  const { data, isLoading, isValidating } = useSWR<{
    rankings: TokenVolumeRanking[];
    meta: RankingMeta;
  }>(CACHE_KEYS.tradingPairs(period, 10), fetcher, { keepPreviousData: true });

  const loading = isLoading || isValidating;

  const rows = useMemo<PairRow[]>(() => {
    if (!data?.rankings) return [];
    return data.rankings.map((r) => ({
      pair: pairLabel(r),
      volume: r.xrpVolume,
      trades: r.tradeCount,
    }));
  }, [data]);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Top Trading Pairs"
        subtitle={
          <span className="hidden font-mono text-cell font-medium text-muted sm:inline">
            Highest XRP volume · book + AMM fills
          </span>
        }
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div className={cn("p-4 transition-opacity", loading && "opacity-40")}>
        {rows.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading pairs..." : "No trading data available"}
            </p>
          </div>
        ) : (
          (() => {
            const maxVolume = Math.max(...rows.map((r) => r.volume), 0.0001);
            return (
              <>
                {/* Column legend — aligns with the row layout below so
                    each label sits over its column. */}
                <div
                  aria-hidden="true"
                  className="mb-2 flex items-center gap-3 px-1"
                >
                  <span className="w-20 shrink-0 font-display text-tag font-medium uppercase tracking-header text-muted">
                    Pair
                  </span>
                  <span className="flex-1 font-display text-tag font-medium uppercase tracking-header text-muted">
                    Volume (XRP)
                  </span>
                  <span className="w-16 shrink-0 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                    Trades
                  </span>
                </div>
                <ul className="space-y-1.5" aria-label="Top trading pairs">
                  {rows.map((r) => {
                    const pct = (r.volume / maxVolume) * 100;
                    return (
                      <li
                        key={r.pair}
                        className="flex items-center gap-3"
                      >
                        <span className="w-20 shrink-0 truncate font-mono text-cell font-medium text-primary">
                          {r.pair}
                        </span>
                        <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-elevated">
                          <div
                            className="absolute inset-y-0 left-0 bg-brand/25 transition-all duration-500 ease-out"
                            style={{ width: `${pct}%` }}
                          />
                          <div className="relative flex h-full items-center px-2">
                            <span className="font-mono text-cell tabular-nums font-medium text-brand">
                              {formatVolume(r.volume)}
                            </span>
                          </div>
                        </div>
                        <span className="w-16 shrink-0 text-right font-mono text-tag tabular-nums text-muted">
                          {formatTrades(r.trades)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}
