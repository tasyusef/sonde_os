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
import type { ActiveWalletsPoint, ActiveWalletsTotal } from "@/types/analytics";

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

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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

export function ActiveWalletsChart() {
  const gradientId = useId();
  const [period, setPeriod] = useState<Period>("7d");

  const { data: raw, isLoading, isValidating } = useSWR<{
    timeSeries: ActiveWalletsPoint[];
    total: ActiveWalletsTotal;
  }>(CACHE_KEYS.activeWallets(period));

  const loading = isLoading || isValidating;
  const totalWallets = raw?.total?.periodUniqueWallets ?? 0;
  const totalTrades = raw?.total?.periodTotalTrades ?? 0;
  const data = raw?.timeSeries ?? [];
  const showTime = period === "7d";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Active Wallets"
        subtitle={
          <>
            <span className="font-mono text-value font-medium tabular-nums text-primary">
              {formatCount(totalWallets)} wallets
            </span>
            {/* Trades count is supplementary — wallets is the headline.
                 Hidden on mobile so the stat row stays a single line. */}
            <span className="hidden font-mono text-cell text-muted sm:inline">
              {formatCount(totalTrades)} trades
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
              {loading ? "Loading active wallets data..." : "No data available"}
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
                  const d = payload[0].payload as ActiveWalletsPoint;
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="font-mono text-label text-muted">
                        {new Date(d.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      <p className="font-mono text-value font-medium text-primary">
                        {d.uniqueWallets.toLocaleString()} wallets
                      </p>
                      <p className="font-mono text-cell text-muted">
                        {d.totalTrades.toLocaleString()} trades
                      </p>
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="uniqueWallets"
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

export default ActiveWalletsChart;
