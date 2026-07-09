"use client";

import { useState, useId } from "react";
import useSWR from "swr";
import { TX_FAMILY_COLORS, CHART_CHROME } from "@/lib/chart-colors";
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
import type { TxVolumePoint } from "@/types/analytics";

type Period = "7d" | "30d" | "90d" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

/** Family → color (from design system tokens) */
const FAMILY_COLORS = TX_FAMILY_COLORS;

const ALL_FAMILIES = Object.keys(FAMILY_COLORS);

const COLORS = {
  muted: CHART_CHROME.muted,
  elevated: CHART_CHROME.elevated,
  surface: "var(--color-surface)",
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

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDateTick(ts: number, showTime: boolean): string {
  const d = new Date(ts);
  if (showTime) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function YTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) + 4} y={Number(y) - 10} width={80} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "inline-block" }}>{formatCount(payload.value)}</span>
    </foreignObject>
  );
}

function XTick({ x, y, payload, showTime }: TickProps & { showTime: boolean }) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) - 40} y={Number(y) + 4} width={80} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "block", textAlign: "center" }}>
        {formatDateTick(payload.value, showTime)}
      </span>
    </foreignObject>
  );
}

interface ChartRow {
  timestamp: number;
  total: number;
  [key: string]: number;
}

export function TxVolumeChart() {
  const gradientPrefix = useId();
  const [period, setPeriod] = useState<Period>("7d");

  const { data: raw, isLoading, isValidating } = useSWR<{
    timeSeries: TxVolumePoint[];
    stats: { totalTxs: number };
  }>(CACHE_KEYS.txVolume(period));

  const loading = isLoading || isValidating;
  const totalTxs = raw?.stats?.totalTxs ?? 0;
  const data: ChartRow[] = (raw?.timeSeries ?? []).map((pt) => {
    const row: ChartRow = { timestamp: pt.timestamp, total: pt.total };
    for (const family of ALL_FAMILIES) {
      row[family] = pt.families[family] ?? 0;
    }
    return row;
  });

  // Determine which families are present in the data
  const activeFamilies = ALL_FAMILIES.filter((f) =>
    data.some((d) => (d[f] ?? 0) > 0),
  );

  const showTime = period === "7d";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Transaction Volume"
        subtitle={
          <span className="font-mono text-value font-medium tabular-nums text-primary">
            {formatCount(totalTxs)} txns
          </span>
        }
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div className={`relative min-h-[220px] flex-1 p-4 transition-opacity ${loading ? "opacity-40" : "opacity-100"}`}>
        <Watermark />
        {data.length < 2 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading tx volume data..." : "No transaction data available"}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                {activeFamilies.map((family) => (
                  <linearGradient key={family} id={`${gradientPrefix}-${family}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={FAMILY_COLORS[family]} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={FAMILY_COLORS[family]} stopOpacity={0} />
                  </linearGradient>
                ))}
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
                  const d = payload[0]?.payload as ChartRow;
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="font-mono text-label text-muted">
                        {new Date(d.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      <p className="mb-1 font-mono text-cell font-medium text-primary">
                        {d.total.toLocaleString()} total txns
                      </p>
                      {activeFamilies
                        .filter((f) => (d[f] ?? 0) > 0)
                        .sort((a, b) => (d[b] ?? 0) - (d[a] ?? 0))
                        .map((f) => (
                          <div key={f} className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: FAMILY_COLORS[f] }} />
                            <span className="font-mono text-tag text-muted">
                              {f}: {(d[f] ?? 0).toLocaleString()}
                            </span>
                          </div>
                        ))}
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              {activeFamilies.map((family) => (
                <Area
                  key={family}
                  type="monotone"
                  dataKey={family}
                  stackId="1"
                  stroke={FAMILY_COLORS[family]}
                  strokeWidth={1}
                  fill={`url(#${gradientPrefix}-${family})`}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend */}
      {activeFamilies.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-elevated px-4 py-2">
          {activeFamilies.map((f) => (
            <div key={f} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: FAMILY_COLORS[f] }} />
              <span className="font-mono text-tag text-muted">{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TxVolumeChart;
