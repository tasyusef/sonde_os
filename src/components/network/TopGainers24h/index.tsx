"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import { cn } from "@/lib/utils";
import { CACHE_KEYS } from "@/lib/swr-config";
import type { TopGainerRow } from "@/lib/top-tokens";

/* ————————————————————————————————————————————
   Top 24h Movers — in-page analytics card.

   Ranks XRPL tokens by 24h price change %. Filtered server-side to
   legitimate tokens (≥50 trustlines) so meme spam doesn't top the
   board. Toggle switches between top gainers and top losers; both
   come from the same endpoint with a direction param. Used on both
   /network (Analytics → DEX & AMM) and /markets (DEX Analytics tab).
   ———————————————————————————————————————————— */

function formatVolume(xrp: number): string {
  if (xrp >= 1_000_000) return `${(xrp / 1_000_000).toFixed(2)}M`;
  if (xrp >= 1_000) return `${(xrp / 1_000).toFixed(1)}K`;
  return xrp.toFixed(0);
}

type Direction = "gainers" | "losers";

const DIRECTION_OPTIONS = [
  { value: "gainers" as const, label: "Gainers" },
  { value: "losers" as const, label: "Losers" },
];

export function TopGainers24h() {
  const [direction, setDirection] = useState<Direction>("gainers");

  const { data, isLoading, isValidating } = useSWR<{
    gainers: TopGainerRow[];
  }>(CACHE_KEYS.topGainers(10, direction), { keepPreviousData: true });

  const loading = isLoading || isValidating;
  const rows = data?.gainers ?? [];
  const isLosers = direction === "losers";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Top Movers"
        subtitle={
          <span className="hidden font-mono text-cell font-medium text-muted sm:inline">
            Biggest 24h price moves · ≥50 trustlines
          </span>
        }
        controls={
          <Toggle
            options={DIRECTION_OPTIONS}
            active={direction}
            onChange={setDirection}
          />
        }
      />

      <div className={cn("relative p-4 transition-opacity", loading && "opacity-40")}>
        {rows.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading
                ? `Loading ${direction}...`
                : `No ${direction} data available`}
            </p>
          </div>
        ) : (
          // Horizontal bar chart: bar width is each row's |pct change|
          // relative to the biggest mover in the set, so the row at the
          // top always gets a full bar and the rest scale proportionally.
          // Volume is the muted secondary metric on the right.
          (() => {
            const maxAbsChange = Math.max(...rows.map((r) => Math.abs(r.pctChange)), 0.0001);
            return (
              <>
                {/* Column legend — aligns with the row layout below so
                    each label sits over its column. */}
                <div
                  aria-hidden="true"
                  className="mb-2 flex items-center gap-3 px-1"
                >
                  <span className="w-20 shrink-0 font-display text-tag font-medium uppercase tracking-header text-muted">
                    Token
                  </span>
                  <span className="flex-1 font-display text-tag font-medium uppercase tracking-header text-muted">
                    24h Change
                  </span>
                  <span className="w-16 shrink-0 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                    Volume
                  </span>
                </div>
                <ul className="space-y-1.5" aria-label={`Top ${direction}`}>
                {rows.map((g) => {
                  const pct = (Math.abs(g.pctChange) / maxAbsChange) * 100;
                  const tokenHref = `/markets/${encodeURIComponent(g.currency)}/${g.issuer}`;
                  return (
                    <li
                      key={`${g.currency}:${g.issuer}`}
                      className="flex items-center gap-3"
                    >
                      <Link
                        href={tokenHref}
                        className="w-20 shrink-0 truncate font-mono text-cell font-medium text-primary transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
                      >
                        {g.ticker}
                      </Link>
                      <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-elevated">
                        <div
                          className={cn(
                            "absolute inset-y-0 left-0 transition-all duration-500 ease-out",
                            isLosers ? "bg-error/20" : "bg-success/25",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                        <div className="relative flex h-full items-center px-2">
                          <span
                            className={cn(
                              "font-mono text-cell tabular-nums font-medium",
                              isLosers ? "text-error" : "text-success",
                            )}
                          >
                            {!isLosers && "+"}
                            {g.pctChange.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <span className="w-16 shrink-0 text-right font-mono text-tag tabular-nums text-muted">
                        {formatVolume(g.volume24hXrp)}
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

export default TopGainers24h;
