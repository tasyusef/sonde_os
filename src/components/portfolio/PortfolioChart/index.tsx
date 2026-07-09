"use client";

import { useState, useId, useMemo } from "react";
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
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { formatVolume } from "@/lib/format";
import { CHART_CHROME } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import Toggle from "@/components/shared/Toggle";
import DropdownMenu from "@/components/shared/DropdownMenu";

/* ——— Types ——— */

interface Snapshot {
  time: string;
  xrpBalance: number;
  xrpPriceUsd: number;
  tokenValueUsd: number;
  nftCount: number;
  ammValueUsd: number;
  lockedXrp: number;
  totalValueUsd: number;
}

interface HistoryResponse {
  snapshots: Snapshot[];
}

type Period = "24h" | "7d" | "30d" | "90d" | "1y" | "all";
type Metric = "total" | "xrp" | "token" | "amm" | "pnl" | "benchmark";

const PERIODS: { label: string; value: Period }[] = [
  { label: "24H", value: "24h" },
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
  { label: "1Y", value: "1y" },
  { label: "All", value: "all" },
];

const METRICS: { label: string; value: Metric }[] = [
  { label: "Total", value: "total" },
  { label: "XRP", value: "xrp" },
  { label: "Tokens", value: "token" },
  { label: "AMM", value: "amm" },
  { label: "PnL", value: "pnl" },
  { label: "vs XRP", value: "benchmark" },
];

const COLORS = CHART_CHROME;

/* ——— Formatters ——— */

function formatDateTick(ts: number, showTime: boolean): string {
  const d = new Date(ts);
  if (showTime) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTooltipDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ——— Tick components ——— */

interface TickProps {
  x?: string | number;
  y?: string | number;
  payload?: { value: number };
}

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

function YTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) + 4} y={Number(y) - 10} width={100} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "inline-block" }}>{formatVolume(payload.value)}</span>
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

/* ——— Main component ——— */

export default function PortfolioChart() {
  const gradientId = useId();
  const [period, setPeriod] = useState<Period>("24h");
  const [metric, setMetric] = useState<Metric>("total");

  const { data, isLoading } = useSWR<HistoryResponse>(
    CACHE_KEYS.portfolioHistory(period),
    fetcher,
  );

  // Memoized so the `?? []` fallback returns a stable reference when
  // there's no data yet — without this, the `chartData` useMemo below
  // re-runs every render despite no actual change.
  const snapshots = useMemo(() => data?.snapshots ?? [], [data?.snapshots]);
  const showTime = period === "24h";

  // Smooth jittery data with a simple moving average
  // Only apply on short periods where 5-min snapshots create noise
  function smooth(
    points: { timestamp: number; value: number; benchmark?: number }[],
    windowSize: number,
  ) {
    if (windowSize <= 1 || points.length <= windowSize) return points;
    return points.map((p, i) => {
      const start = Math.max(0, i - Math.floor(windowSize / 2));
      const end = Math.min(points.length, i + Math.ceil(windowSize / 2));
      const window = points.slice(start, end);
      const avgValue = window.reduce((s, w) => s + w.value, 0) / window.length;
      const avgBenchmark =
        p.benchmark != null
          ? window.reduce((s, w) => s + (w.benchmark ?? 0), 0) / window.length
          : undefined;
      return { ...p, value: avgValue, benchmark: avgBenchmark };
    });
  }

  const isBenchmark = metric === "benchmark";

  // Memoized — 90d snapshots are 800-1500 points, both the .map and
  // smooth() recompute on every parent SWR revalidation tick. Keying
  // on the actual inputs prevents the work from running otherwise.
  const chartData = useMemo(() => {
    const first = snapshots[0];
    const raw = snapshots.map((s) => {
      const ts = new Date(s.time).getTime();
      const xrpValue = s.xrpBalance * s.xrpPriceUsd;

      let value: number;
      let benchmark: number | undefined;

      switch (metric) {
        case "xrp":
          value = xrpValue;
          break;
        case "token":
          value = s.tokenValueUsd;
          break;
        case "amm":
          value = s.ammValueUsd;
          break;
        case "pnl": {
          const initialXrp = first?.xrpBalance ?? 0;
          const initialLockedXrp = first?.lockedXrp ?? 0;
          const xrpPriceDelta = s.xrpPriceUsd - (first?.xrpPriceUsd ?? 0);
          const xrpPnl = (initialXrp + initialLockedXrp) * xrpPriceDelta;
          const tokenPnl = s.tokenValueUsd - (first?.tokenValueUsd ?? 0);
          const ammPnl = s.ammValueUsd - (first?.ammValueUsd ?? 0);
          value = xrpPnl + tokenPnl + ammPnl;
          break;
        }
        case "benchmark": {
          value = s.totalValueUsd;
          const initialValue = first?.totalValueUsd ?? 0;
          const initialPrice = first?.xrpPriceUsd || 1;
          benchmark = (initialValue / initialPrice) * s.xrpPriceUsd;
          break;
        }
        default:
          value = s.totalValueUsd;
      }

      return { timestamp: ts, value, benchmark };
    });

    // Apply smoothing: 24h gets window of 5, 7d gets 3, others untouched
    const smoothWindow = period === "24h" ? 5 : period === "7d" ? 3 : 1;
    return smooth(raw, smoothWindow);
  }, [snapshots, metric, period]);

  const isPnl = metric === "pnl";
  const latestValue = chartData.length > 0 ? chartData[chartData.length - 1].value : 0;
  const latestBenchmark = isBenchmark && chartData.length > 0 ? chartData[chartData.length - 1].benchmark ?? 0 : 0;

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      {/* Header — label, price, and metric dropdown share one row at
           every viewport. The benchmark "vs ..." sublabel hides on
           mobile so the dropdown doesn't wrap; the rest fits at all
           widths. */}
      <div className="flex items-center justify-between gap-3 border-b border-elevated px-4 py-card-header">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="font-display text-label font-medium uppercase tracking-header text-muted">
            {METRICS.find((m) => m.value === metric)?.label}
          </span>
          <span className={cn(
            "truncate font-mono text-value font-medium tabular-nums",
            isPnl
              ? latestValue >= 0 ? "text-success" : "text-error"
              : "text-primary",
          )}>
            {isPnl && latestValue > 0 ? "+" : ""}
            {formatVolume(latestValue)}
          </span>
          {isBenchmark && (
            <span className="hidden font-mono text-label tabular-nums text-muted sm:inline">
              vs {formatVolume(latestBenchmark)} (100% XRP)
            </span>
          )}
        </div>

        {/* Metric picker — dropdown since 6 options don't fit a pill
             toggle comfortably on any viewport. */}
        <DropdownMenu
          triggerLabel={METRICS.find((m) => m.value === metric)?.label ?? "Select"}
          triggerVariant="secondary"
          triggerSize="sm"
          align="right"
          width="auto"
          label="Select metric"
          selectedValue={metric}
          items={METRICS.map((m) => ({ value: m.value, label: m.label }))}
          onSelect={(v) => setMetric(v as Metric)}
        />
      </div>

      {/* Chart */}
      <div
        className={cn(
          "relative min-h-[260px] flex-1 p-4 transition-opacity",
          isLoading ? "opacity-40" : "opacity-100",
        )}
      >
        {chartData.length < 2 ? (
          <div className="flex h-full min-h-[260px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {isLoading ? "Loading..." : "No snapshot data yet — check back in a few hours"}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.brand} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={COLORS.brand} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                horizontal
                vertical={false}
                stroke={COLORS.elevated}
                strokeDasharray=""
              />

              <XAxis
                dataKey="timestamp"
                type="number"
                domain={["dataMin", "dataMax"]}
                scale="time"
                tick={(props: TickProps) => <XTick {...props} showTime={showTime} />}
                axisLine={false}
                tickLine={false}
                tickMargin={0}
                minTickGap={60}
              />

              <YAxis
                domain={["auto", "auto"]}
                tick={(props: TickProps) => <YTick {...props} />}
                axisLine={false}
                tickLine={false}
                tickMargin={0}
                width={4}
                mirror
              />

              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { timestamp: number; value: number; benchmark?: number };
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="font-mono text-label text-muted">
                        {formatTooltipDate(d.timestamp)}
                      </p>
                      <p className={cn(
                        "font-mono text-value font-medium",
                        isPnl
                          ? d.value >= 0 ? "text-success" : "text-error"
                          : "text-primary",
                      )}>
                        {isPnl && d.value > 0 ? "+" : ""}
                        {isBenchmark ? "Portfolio: " : ""}
                        {formatVolume(d.value)}
                      </p>
                      {isBenchmark && d.benchmark != null && (
                        <>
                          <p className="font-mono text-cell text-muted">
                            100% XRP: {formatVolume(d.benchmark)}
                          </p>
                          <p className={cn(
                            "font-mono text-cell font-medium",
                            d.value >= d.benchmark ? "text-success" : "text-error",
                          )}>
                            {d.value >= d.benchmark ? "+" : ""}
                            {formatVolume(d.value - d.benchmark)} delta
                          </p>
                        </>
                      )}
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: "4 4" }}
              />

              {isBenchmark && (
                <Area
                  type="monotone"
                  dataKey="benchmark"
                  stroke={COLORS.muted}
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  fill="none"
                  animationDuration={600}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={COLORS.brand}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                animationDuration={600}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Period toggles */}
      <div className="flex border-t border-elevated px-4 py-2.5">
        <Toggle options={PERIODS} active={period} onChange={setPeriod} />
      </div>
    </section>
  );
}
