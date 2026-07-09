"use client";

import useSWR from "swr";
import { cn } from "@/lib/utils";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import { CACHE_KEYS } from "@/lib/swr-config";
import type { TrustlineWinnerRow } from "@/lib/top-tokens";

/* ————————————————————————————————————————————
   Trustline Winners (24H) — in-page analytics card.

   Tokens gaining the most net new trustlines in 24h — a direct
   adoption-momentum signal. Shows added / removed columns so
   readers can judge whether growth is net-positive activity or
   churn. Used on /network and /markets.
   ———————————————————————————————————————————— */

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function TrustlineWinners24h() {
  const { data, isLoading, isValidating } = useSWR<{
    tokens: TrustlineWinnerRow[];
  }>(CACHE_KEYS.trustlineWinners(10));

  const loading = isLoading || isValidating;
  const tokens = data?.tokens ?? [];

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Trustline Gainers"
        subtitle={
          <span className="hidden font-mono text-cell font-medium text-muted sm:inline">
            Tokens gaining the most holders in 24h
          </span>
        }
        controls={
          /* Static "24H" tag — this card only shows the 24h window,
              no toggle. Period is implicit in the title. */
          <span className="font-display text-tag uppercase tracking-header text-muted">
            24H
          </span>
        }
      />

      <div className={cn("relative p-4 transition-opacity", loading && "opacity-40")}>
        {tokens.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading trustline data..." : "No trustline growth in the last 24h"}
            </p>
          </div>
        ) : (
          // Diverging tornado chart: removed bars grow from the center
          // axis to the LEFT in red, added bars grow to the RIGHT in
          // green. Both halves share the same scale (max gross flow
          // across the whole list) so the visual proportions are
          // honest. Net new lives on the right edge as the headline
          // takeaway.
          (() => {
            const maxFlow = Math.max(
              ...tokens.flatMap((t) => [t.added, t.removed]),
              1,
            );
            return (
              <>
                {/* Column legend. The diverging-bar column gets explicit
                    direction markers in the appropriate colors so the
                    reading of the chart (red left = removed, green right
                    = added) is unambiguous before the eye even hits the
                    rows. */}
                <div
                  aria-hidden="true"
                  className="mb-2 flex items-center gap-2 px-1"
                >
                  <span className="w-20 shrink-0 font-display text-tag font-medium uppercase tracking-header text-muted">
                    Token
                  </span>
                  <div className="flex flex-1 items-center justify-center gap-1.5 font-display text-tag font-medium uppercase tracking-header">
                    <span className="text-error">← Removed</span>
                    <span className="text-muted">·</span>
                    <span className="text-success">Added →</span>
                  </div>
                  <span className="w-14 shrink-0 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                    Net New
                  </span>
                </div>
                <ul className="space-y-1.5" aria-label="Trustline winners">
                {tokens.map((t) => {
                  const removedPct = (t.removed / maxFlow) * 100;
                  const addedPct = (t.added / maxFlow) * 100;
                  return (
                    <li
                      key={`${t.currency}:${t.issuer}`}
                      className="flex items-center gap-2"
                    >
                      <span className="w-20 shrink-0 truncate font-mono text-cell font-medium text-primary">
                        {t.ticker}
                      </span>
                      <div className="relative flex h-7 flex-1 items-stretch">
                        {/* Removed half — anchors at the right edge of
                             this side, bar fills toward the center axis.
                             Hidden when removed is 0 so we don't draw a
                             0-width strip with empty padding. */}
                        <div className="relative flex flex-1 justify-end overflow-hidden rounded-l-md bg-elevated">
                          {t.removed > 0 && (
                            <>
                              <div
                                className="absolute inset-y-0 right-0 bg-error/20 transition-all duration-500 ease-out"
                                style={{ width: `${removedPct}%` }}
                              />
                              <span className="relative flex items-center pr-2 font-mono text-tag tabular-nums text-error">
                                −{formatCount(t.removed)}
                              </span>
                            </>
                          )}
                        </div>
                        {/* Center axis */}
                        <div
                          aria-hidden="true"
                          className="w-px shrink-0 bg-secondary/30"
                        />
                        {/* Added half — anchors at the left edge of this
                             side, bar fills toward the right. */}
                        <div className="relative flex flex-1 overflow-hidden rounded-r-md bg-elevated">
                          <div
                            className="absolute inset-y-0 left-0 bg-success/25 transition-all duration-500 ease-out"
                            style={{ width: `${addedPct}%` }}
                          />
                          <span className="relative flex items-center pl-2 font-mono text-tag tabular-nums text-success">
                            +{formatCount(t.added)}
                          </span>
                        </div>
                      </div>
                      <span className="w-14 shrink-0 text-right font-mono text-cell tabular-nums font-medium text-success">
                        +{formatCount(t.netNew)}
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

export default TrustlineWinners24h;
