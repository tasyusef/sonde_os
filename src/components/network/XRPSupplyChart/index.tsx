"use client";

import { useState, useId } from "react";
import useSWR from "swr";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import Watermark from "@/components/shared/Watermark";
import { CACHE_KEYS } from "@/lib/swr-config";
import { CHART_CHROME } from "@/lib/chart-colors";
import { formatChartDateTick } from "@/lib/format";
import type { XRPSupplyPoint, XRPSupplyTotal } from "@/types/analytics";

type Period = "7d" | "30d" | "90d" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

const COLORS = CHART_CHROME;

const TICK_BOX: React.CSSProperties = {
  padding: "1px 6px",
  borderRadius: 3,
  background: "color-mix(in srgb, var(--color-surface) 75%, transparent)",
  fontSize: "var(--text-label)",
  fontFamily: "var(--font-mono)",
  color: "var(--color-muted)",
  lineHeight: "18px",
  whiteSpace: "nowrap",
};

interface TickProps {
  x?: string | number;
  y?: string | number;
  payload?: { value: number };
}

/** Truncate to N decimal places (never rounds up) */
function truncFixed(n: number, decimals: number): string {
  const factor = 10 ** decimals;
  return (Math.floor(n * factor) / factor).toFixed(decimals);
}

function formatSupply(xrp: number): string {
  if (xrp >= 1_000_000_000) {
    const b = xrp / 1_000_000_000;
    // Truncate, never round — 99.999999B must not become 100.0000B
    return `${truncFixed(b, 4)}B`;
  }
  if (xrp >= 1_000_000) return `${truncFixed(xrp / 1_000_000, 2)}M`;
  if (xrp >= 1_000) return `${truncFixed(xrp / 1_000, 1)}K`;
  return truncFixed(xrp, 2);
}

function formatXrpCompact(xrp: number): string {
  if (xrp >= 1_000_000) return `${truncFixed(xrp / 1_000_000, 2)}M`;
  if (xrp >= 1_000) return `${truncFixed(xrp / 1_000, 1)}K`;
  return truncFixed(xrp, 2);
}

function formatTickSupply(xrp: number): string {
  // Y-axis ticks — truncate, never round up
  if (xrp >= 1_000_000_000) return `${truncFixed(xrp / 1_000_000_000, 4)}B`;
  if (xrp >= 1_000_000) return `${(xrp / 1_000_000).toFixed(2)}M`;
  if (xrp >= 1_000) return `${(xrp / 1_000).toFixed(1)}K`;
  return xrp.toFixed(2);
}

/** Compute an honest y-axis domain for the supply line.
 *
 * Auto-domain (`["dataMin", "dataMax"]`) zooms to fit only the data range,
 * which makes a 0.001%-of-supply burn over a week look like the supply is
 * collapsing — visually deceptive given XRP's near-static total supply.
 *
 * Instead, anchor the domain so the data range occupies ~25-30% of the
 * chart height: pad 2× the range below the min and 0.5× above the max.
 * Net effect: the line sits in the upper third with most of the chart
 * showing the (truthful) "lots of supply still remaining" empty space
 * below. Movement is still legible, but proportional.
 *
 * For tiny ranges (e.g., one ledger of fee burn over a 7d window), we
 * floor the pad at 0.01% of supply so the chart doesn't degenerate to
 * a perfectly flat line at extreme zoom.
 */
function calcSupplyDomain(data: XRPSupplyPoint[]): [number, number] {
  if (data.length < 2) return ["auto", "auto"] as unknown as [number, number];
  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    if (d.remainingSupplyXrp < min) min = d.remainingSupplyXrp;
    if (d.remainingSupplyXrp > max) max = d.remainingSupplyXrp;
  }
  const range = max - min;
  const minPad = Math.max(range * 2, max * 0.0001); // ≥ 0.01% of supply
  const maxPad = Math.max(range * 0.5, max * 0.00005);
  return [min - minPad, max + maxPad];
}

function YTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) + 4} y={Number(y) - 10} width={100} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "inline-block" }}>{formatTickSupply(payload.value)}</span>
    </foreignObject>
  );
}

function XTick({ x, y, payload, showTime }: TickProps & { showTime: boolean }) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) - 40} y={Number(y) + 4} width={80} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "block", textAlign: "center" }}>
        {formatChartDateTick(payload.value, showTime)}
      </span>
    </foreignObject>
  );
}

export function XRPSupplyChart() {
  const gradientId = useId();
  const [period, setPeriod] = useState<Period>("7d");

  const { data: raw, isLoading, isValidating } = useSWR<{
    timeSeries: XRPSupplyPoint[];
    total: XRPSupplyTotal;
  }>(CACHE_KEYS.xrpSupply(period));

  const loading = isLoading || isValidating;
  const total = raw?.total;
  const data = raw?.timeSeries ?? [];
  const showTime = period === "7d";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="XRP Supply"
        subtitle={
          <>
            <span className="font-mono text-value font-medium tabular-nums text-primary">
              {total ? formatSupply(total.remainingSupplyXrp) : "—"} XRP
            </span>
            {/* Cumulative burn + period burn — supplementary context to
                 the current supply headline. Hidden on mobile. */}
            <span className="hidden font-mono text-cell text-muted sm:inline">
              Burned: {total ? formatXrpCompact(total.totalBurnedXrp) : "—"} XRP
              {total && total.periodBurnXrp > 0 && (
                <> ({formatXrpCompact(total.periodBurnXrp)} this period)</>
              )}
            </span>
          </>
        }
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div className={`relative min-h-[220px] flex-1 p-4 transition-opacity ${loading ? "opacity-40" : "opacity-100"}`}>
        <Watermark />
        {data.length < 2 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading supply data..." : "No data available"}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.brand} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={COLORS.brand} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid horizontal vertical={false} stroke={COLORS.elevated} />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={["dataMin", "dataMax"]}
                scale="time"
                tick={(props: TickProps) => <XTick {...props} showTime={showTime} />}
                axisLine={false}
                tickLine={false}
                minTickGap={60}
              />
              <YAxis
                domain={calcSupplyDomain(data)}
                tick={(props: TickProps) => <YTick {...props} />}
                axisLine={false}
                tickLine={false}
                width={4}
                mirror
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as XRPSupplyPoint;
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="font-mono text-label text-muted">
                        {new Date(d.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      <p className="font-mono text-value font-medium text-primary">
                        {formatSupply(d.remainingSupplyXrp)} XRP remaining
                      </p>
                      <p className="font-mono text-cell text-error">
                        {formatXrpCompact(d.cumulativeBurnXrp)} XRP burned
                      </p>
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="remainingSupplyXrp"
                stroke={COLORS.brand}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, fill: COLORS.brand, stroke: COLORS.surface, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default XRPSupplyChart;
