"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import Watermark from "@/components/shared/Watermark";
import { CACHE_KEYS } from "@/lib/swr-config";
import type { CorridorEntry, CorridorStats } from "@/types/analytics";
import {
  CURRENCY_COLORS,
  CURRENCY_FALLBACK_PALETTE as FALLBACK_COLORS,
} from "@/lib/chart-colors";
import RibbonDiagram from "./RibbonDiagram";

type Period = "24h" | "7d" | "30d";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

function formatVolume(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export function CorridorChart() {
  const [period, setPeriod] = useState<Period>("7d");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const { data: raw, isLoading, isValidating } = useSWR<{
    corridors: CorridorEntry[];
    stats: CorridorStats;
  }>(CACHE_KEYS.corridors(period));

  const loading = isLoading || isValidating;
  const corridors = raw?.corridors ?? [];
  const stats = raw?.stats ?? null;

  const handleHover = useCallback((idx: number | null) => setHoveredIdx(idx), []);

  const maxVolume = corridors.length > 0 ? Math.max(...corridors.map((c) => c.xrpVolume)) : 1;

  return (
    <div className="rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Payment Corridors"
        subtitle={
          stats && (
            <>
              <span className="font-mono text-value font-medium tabular-nums text-primary">
                {stats.totalPayments.toLocaleString()} payments
              </span>
              <span className="hidden font-mono text-cell text-muted sm:inline">
                {stats.totalCorridors} corridors · {formatVolume(stats.totalXrpVolume)} XRP
              </span>
            </>
          )
        }
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div className={`relative transition-opacity ${loading ? "opacity-40" : "opacity-100"}`}>
        <Watermark placement="bottom-right" />
        {corridors.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading corridor data..." : "No corridor data available"}
            </p>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div className="flex justify-between px-4 pt-3 pb-0">
              <span className="font-display text-tag font-medium uppercase tracking-header text-muted">Sending</span>
              <span className="font-display text-tag font-medium uppercase tracking-header text-muted">Receiving</span>
            </div>

            {/* Ribbon diagram */}
            <div className="px-4 pb-4">
              <RibbonDiagram corridors={corridors} hoveredIdx={hoveredIdx} onHover={handleHover} />
            </div>

            {/* Corridor list */}
            <div className="border-t border-elevated px-4 py-3">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {corridors.map((c, i) => {
                  const highlighted = hoveredIdx === i;
                  const color = CURRENCY_COLORS[c.srcCurrency] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
                  const pct = (c.xrpVolume / maxVolume) * 100;
                  return (
                    <div
                      key={`${c.srcCurrency}-${c.dstCurrency}-${i}`}
                      className={`relative overflow-hidden rounded-lg border px-3 py-2 transition-colors cursor-default ${
                        highlighted ? "border-brand/30 bg-row-hover" : "border-elevated bg-surface"
                      }`}
                      onMouseEnter={() => setHoveredIdx(i)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    >
                      {/* Background volume fill */}
                      <div
                        className="pointer-events-none absolute inset-y-0 left-0"
                        style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.06 }}
                      />
                      {/* Color accent bar */}
                      <div
                        className="absolute top-0 bottom-0 left-0 w-[3px] rounded-l-lg"
                        style={{ backgroundColor: color }}
                      />
                      <div className="relative flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-cell font-medium text-primary">{c.srcCurrency}</span>
                          <span className="font-mono text-tag text-muted">→</span>
                          <span className="font-mono text-cell font-medium text-primary">{c.dstCurrency}</span>
                          {(c.srcName || c.dstName) && (
                            <span className="hidden font-mono text-tag text-muted sm:inline truncate">
                              {c.srcName || c.dstName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline gap-2 shrink-0">
                          <span className="font-mono text-tag tabular-nums text-muted">{c.count.toLocaleString()}</span>
                          <span className="font-mono text-cell tabular-nums text-secondary font-medium">
                            {formatVolume(c.xrpVolume)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default CorridorChart;
