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
import { formatXrpValue, formatChartDateTick } from "@/lib/format";
import type { NFTActivityPoint } from "@/types/analytics";
import { CHART_CHROME } from "@/lib/chart-colors";

type Period = "7d" | "30d" | "90d" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

const COLORS = {
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

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(0);
  return n.toFixed(0);
}


function YTickNumber({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) + 4} y={Number(y) - 10} width={80} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "inline-block" }}>{formatNumber(payload.value)}</span>
    </foreignObject>
  );
}

function YTickXrp({ x, y, payload }: TickProps) {
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

/* ——— NFT Trade Volume (trade count) ——— */

export function NFTTradeVolumeChart() {
  const gradientId = useId();
  const [period, setPeriod] = useState<Period>("7d");

  const { data: raw, isLoading, isValidating } = useSWR<{
    timeSeries: NFTActivityPoint[];
    total: { periodTradeCount: number; periodXrpVolume: number };
  }>(CACHE_KEYS.nftActivity(period));

  const loading = isLoading || isValidating;
  const data = raw?.timeSeries ?? [];
  const totalTrades = raw?.total?.periodTradeCount ?? 0;
  const showTime = period === "7d";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="NFT Trade Volume"
        subtitle={
          <>
            <span className="font-mono text-value font-medium tabular-nums text-primary">
              {totalTrades.toLocaleString()}
            </span>
            <span className="font-mono text-cell text-muted">trades</span>
          </>
        }
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div className={`relative min-h-[220px] flex-1 p-4 transition-opacity ${loading ? "opacity-40" : "opacity-100"}`}>
        <Watermark />
        {data.length < 2 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading trade data..." : "No trade data available"}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_CHROME.brand} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={CHART_CHROME.brand} stopOpacity={0} />
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
                tick={(props: TickProps) => <YTickNumber {...props} />}
                axisLine={false}
                tickLine={false}
                width={4}
                mirror
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as NFTActivityPoint;
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="font-mono text-label text-muted">
                        {new Date(d.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      <p className="font-mono text-value font-medium text-primary">
                        {d.tradeCount.toLocaleString()} trades
                      </p>
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="tradeCount"
                stroke={CHART_CHROME.brand}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, fill: CHART_CHROME.brand, stroke: COLORS.surface, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/* ——— NFT XRP Volume ——— */

export function NFTXrpVolumeChart() {
  const gradientId = useId();
  const [period, setPeriod] = useState<Period>("7d");

  const { data: raw, isLoading, isValidating } = useSWR<{
    timeSeries: NFTActivityPoint[];
    total: { periodTradeCount: number; periodXrpVolume: number };
  }>(CACHE_KEYS.nftActivity(period));

  const loading = isLoading || isValidating;
  const data = raw?.timeSeries ?? [];
  const totalVolume = raw?.total?.periodXrpVolume ?? 0;
  const showTime = period === "7d";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="NFT XRP Volume"
        subtitle={
          <>
            <span className="font-mono text-value font-medium tabular-nums text-primary">
              {totalVolume >= 1_000_000 ? `${(totalVolume / 1_000_000).toFixed(2)}M` : totalVolume >= 1_000 ? `${(totalVolume / 1_000).toFixed(1)}K` : totalVolume.toFixed(2)}
            </span>
            <span className="font-mono text-cell text-muted">XRP</span>
          </>
        }
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div className={`relative min-h-[220px] flex-1 p-4 transition-opacity ${loading ? "opacity-40" : "opacity-100"}`}>
        <Watermark />
        {data.length < 2 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading volume data..." : "No volume data available"}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_CHROME.brand} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={CHART_CHROME.brand} stopOpacity={0} />
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
                tick={(props: TickProps) => <YTickXrp {...props} />}
                axisLine={false}
                tickLine={false}
                width={4}
                mirror
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as NFTActivityPoint;
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="font-mono text-label text-muted">
                        {new Date(d.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      <p className="font-mono text-value font-medium text-primary">
                        {formatXrpValue(d.xrpVolume)} XRP
                      </p>
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="xrpVolume"
                stroke={CHART_CHROME.brand}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, fill: CHART_CHROME.brand, stroke: COLORS.surface, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
