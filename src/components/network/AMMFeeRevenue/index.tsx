"use client";

import { useState, useId, useMemo } from "react";
import useSWR from "swr";
import {
  AreaChart,
  LineChart,
  Line,
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
import { formatXrpValue, formatChartDateTick } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AMMRevenuePoint, AMMRevenueTotal, AMMPoolRevenueSeries } from "@/types/analytics";

type Period = "7d" | "30d" | "90d" | "all";
type ChartMode = "total" | "pools";

const CHART_MODES: { value: ChartMode; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "pools", label: "By Pool" },
];

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

import { MULTI_SERIES_PALETTE, CHART_CHROME } from "@/lib/chart-colors";

const POOL_COLORS = MULTI_SERIES_PALETTE;

const COLORS = {
  brand: CHART_CHROME.brand,
  muted: CHART_CHROME.muted,
  elevated: CHART_CHROME.elevated,
  surface: CHART_CHROME.surface,
};

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


function YTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) + 4} y={Number(y) - 10} width={80} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "inline-block" }}>{formatXrpValue(payload.value)}</span>
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

/**
 * Merge per-pool time series into a single flat array keyed by timestamp,
 * with one field per pool (e.g. { timestamp, "SOLO": 1.2, "CSC": 0.8, ... }).
 */
function mergePoolSeries(poolSeries: AMMPoolRevenueSeries[]): Record<string, unknown>[] {
  const bucketMap = new Map<number, Record<string, unknown>>();

  for (const pool of poolSeries) {
    for (const point of pool.data) {
      let row = bucketMap.get(point.timestamp);
      if (!row) {
        row = { timestamp: point.timestamp };
        bucketMap.set(point.timestamp, row);
      }
      row[pool.currency] = point.estimatedFeeXrp;
    }
  }

  return Array.from(bucketMap.values()).sort(
    (a, b) => (a.timestamp as number) - (b.timestamp as number),
  );
}

export function AMMFeeRevenue() {
  const gradientId = useId();
  const [period, setPeriod] = useState<Period>("7d");
  const [chartMode, setChartMode] = useState<ChartMode>("pools");

  const { data: raw, isLoading, isValidating } = useSWR<{
    timeSeries: AMMRevenuePoint[];
    total: AMMRevenueTotal;
    poolSeries: AMMPoolRevenueSeries[];
  }>(CACHE_KEYS.ammRevenue(period));

  const loading = isLoading || isValidating;
  const data = raw?.timeSeries ?? [];
  const total = raw?.total ?? { periodFeeXrp: 0, topEarners: [] };
  const poolSeries = useMemo(() => raw?.poolSeries ?? [], [raw?.poolSeries]);

  const showTime = period === "7d";
  const mergedPoolData = useMemo(() => mergePoolSeries(poolSeries), [poolSeries]);
  const poolCurrencies = useMemo(() => poolSeries.map((p) => p.currency), [poolSeries]);

  const hasData = chartMode === "total" ? data.length >= 2 : mergedPoolData.length >= 2;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="AMM Fee Revenue (Est.)"
        subtitle={
          <span className="font-mono text-value font-medium tabular-nums text-primary">
            {formatXrpValue(total.periodFeeXrp)} XRP
          </span>
          /* Dropped the "Top: SOLO" secondary stat — it's already
              shown in the Top Pools by Fee Revenue table below the
              chart, so re-stating it in the header is redundant
              chrome that was making the mobile header tall. */
        }
        controls={
          /* Two toggles stacked vertically, right-aligned. Tim's call:
             a row-of-two felt cramped against the title; stacking
             reads cleaner and keeps each toggle's full label
             visible. items-end aligns them to the right edge so the
             shorter (TOTAL/BY POOL) toggle still hugs the right
             margin even though it's narrower than 7D/30D/90D/ALL. */
          <div className="flex flex-col items-end gap-2">
            <Toggle options={CHART_MODES} active={chartMode} onChange={setChartMode} />
            <Toggle options={PERIODS} active={period} onChange={setPeriod} />
          </div>
        }
      />

      <div className={`relative min-h-[220px] flex-1 p-4 transition-opacity ${loading ? "opacity-40" : "opacity-100"}`}>
        <Watermark />
        {!hasData ? (
          <div className="flex h-full min-h-[180px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading AMM revenue..." : "No AMM revenue data available"}
            </p>
          </div>
        ) : chartMode === "total" ? (
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
                domain={["auto", "auto"]}
                tick={(props: TickProps) => <YTick {...props} />}
                axisLine={false}
                tickLine={false}
                width={4}
                mirror
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as AMMRevenuePoint;
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="font-mono text-label text-muted">
                        {new Date(d.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      <p className="font-mono text-value font-medium text-primary">
                        {formatXrpValue(d.estimatedFeeXrp)} XRP fees
                      </p>
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="estimatedFeeXrp"
                stroke={COLORS.brand}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, fill: COLORS.brand, stroke: COLORS.surface, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          /* Multi-line chart — one line per pool */
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={mergedPoolData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
                domain={["auto", "auto"]}
                tick={(props: TickProps) => <YTick {...props} />}
                axisLine={false}
                tickLine={false}
                width={4}
                mirror
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const ts = payload[0].payload.timestamp as number;
                  const sorted = [...payload].sort(
                    (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0),
                  );
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="mb-1 font-mono text-label text-muted">
                        {new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      {sorted.map((entry) => (
                        <div key={entry.dataKey as string} className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: entry.color }}
                            />
                            <span className="font-mono text-label text-secondary">
                              {entry.dataKey as string}
                            </span>
                          </div>
                          <span className="font-mono text-label tabular-nums text-primary">
                            {formatXrpValue(Number(entry.value) || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              {poolCurrencies.map((currency, i) => (
                <Line
                  key={currency}
                  type="monotone"
                  dataKey={currency}
                  stroke={POOL_COLORS[i % POOL_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 1.5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top AMM Pools by Fee Revenue.
           Mobile: single list with all 10 rows (no table chrome — the
            "rank · dot · pool · fees" rhythm reads as a list naturally,
            and Tim flagged that the previous table approach showed
            duplicate column headers when the two halves stacked).
           Desktop: 2-column split table (5 rows per column) since the
            tabular layout reads better at wider widths. */}
      {total.topEarners.length > 0 && (
        <div className={cn("border-t border-elevated py-3 px-4 transition-opacity", loading && "opacity-40")}>
          <p className="mb-2 font-display text-tag font-medium uppercase tracking-header text-muted">
            Top Pools by Fee Revenue
          </p>

          {/* Mobile list — single scan, no duplicated headers */}
          <ul className="divide-y divide-elevated sm:hidden">
            {total.topEarners.map((earner, i) => {
              const rank = i + 1;
              return (
                <li
                  key={`${earner.currency}:${earner.issuerName ?? rank}`}
                  className="flex items-center gap-3 py-row-compact"
                >
                  <span className="w-5 shrink-0 font-mono text-cell tabular-nums text-muted">
                    {rank}
                  </span>
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: POOL_COLORS[(rank - 1) % POOL_COLORS.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-cell font-medium text-primary">
                    {earner.currency} / XRP
                  </span>
                  <span className="shrink-0 font-mono text-cell tabular-nums text-secondary">
                    {formatXrpValue(earner.feeXrp)}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Desktop split table — 2 columns of 5 */}
          <div className="hidden gap-x-6 sm:grid sm:grid-cols-2">
            {[
              total.topEarners.slice(0, Math.ceil(total.topEarners.length / 2)),
              total.topEarners.slice(Math.ceil(total.topEarners.length / 2)),
            ].map((column, colIdx) => (
              <table key={colIdx} className="w-full">
                <thead>
                  <tr>
                    <th scope="col" className="pb-1 text-left font-display text-tag font-medium uppercase tracking-header text-muted">
                      #
                    </th>
                    <th scope="col" className="pb-1 text-left font-display text-tag font-medium uppercase tracking-header text-muted">
                      Pool
                    </th>
                    <th scope="col" className="pb-1 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                      Fees (XRP)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {column.map((earner, i) => {
                    const rank = colIdx * Math.ceil(total.topEarners.length / 2) + i + 1;
                    return (
                      <tr key={`${earner.currency}:${earner.issuerName ?? rank}`} className="border-b border-elevated last:border-b-0">
                        <td className="w-6 py-row-compact font-mono text-cell tabular-nums text-muted">
                          {rank}
                        </td>
                        <td className="py-row-compact">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: POOL_COLORS[(rank - 1) % POOL_COLORS.length] }}
                            />
                            <span className="font-mono text-cell font-medium text-primary">
                              {earner.currency} / XRP
                            </span>
                            {earner.issuerName && (
                              <span className="hidden font-mono text-tag text-muted lg:inline">
                                ({earner.issuerName})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-row-compact text-right font-mono text-cell tabular-nums text-secondary">
                          {formatXrpValue(earner.feeXrp)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default AMMFeeRevenue;
