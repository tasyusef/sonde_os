"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CHROME } from "@/lib/chart-colors";

/* ————————————————————————————————————————————
   PreviewAreaChart

   A presentational recharts AreaChart for preview and marketing cards.
   Mirrors the exact composition used by real chart components like
   FeeBurnChart and PortfolioChart — same gradient, grid, axes, ticks,
   and active-dot treatment — but takes its data as props instead of
   fetching from SWR.

   Keeps the marketing cards visually identical to production charts
   without re-implementing the recharts plumbing in each one.
   ———————————————————————————————————————————— */

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

interface PreviewAreaChartProps {
  /** Time-series data: timestamps (ms) + numeric values */
  data: { timestamp: number; value: number }[];
  /** Chart height in pixels. Defaults to 220. */
  height?: number;
  /**
   * Line / area color. Accepts a CSS variable reference like
   * `var(--color-brand)` or `var(--color-success)`. Defaults to brand.
   */
  color?: string;
  /** Y-axis tick formatter. Defaults to compact K/M/B. */
  formatY?: (value: number) => string;
  /** X-axis tick formatter. Defaults to "MMM D". */
  formatX?: (timestamp: number) => string;
  /** Show X-axis ticks. Defaults to true. */
  showXAxis?: boolean;
  /** Show Y-axis ticks. Defaults to true. */
  showYAxis?: boolean;
  /** Show the horizontal gridlines. Defaults to true. */
  showGrid?: boolean;
}

function defaultFormatY(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function defaultFormatX(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function YTickRenderer({
  x,
  y,
  payload,
  format,
}: TickProps & { format: (v: number) => string }) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject
      x={Number(x) + 4}
      y={Number(y) - 10}
      width={100}
      height={20}
      style={{ overflow: "visible" }}
    >
      <span style={{ ...TICK_BOX, display: "inline-block" }}>
        {format(payload.value)}
      </span>
    </foreignObject>
  );
}

function XTickRenderer({
  x,
  y,
  payload,
  format,
}: TickProps & { format: (v: number) => string }) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject
      x={Number(x) - 40}
      y={Number(y) + 4}
      width={80}
      height={20}
      style={{ overflow: "visible" }}
    >
      <span style={{ ...TICK_BOX, display: "block", textAlign: "center" }}>
        {format(payload.value)}
      </span>
    </foreignObject>
  );
}

export function PreviewAreaChart({
  data,
  height = 220,
  color = CHART_CHROME.brand,
  formatY = defaultFormatY,
  formatX = defaultFormatX,
  showXAxis = true,
  showYAxis = true,
  showGrid = true,
}: PreviewAreaChartProps) {
  const gradientId = useId();

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showGrid && (
            <CartesianGrid
              horizontal
              vertical={false}
              stroke={CHART_CHROME.elevated}
            />
          )}
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tick={(props: TickProps) => (
              <XTickRenderer {...props} format={formatX} />
            )}
            axisLine={false}
            tickLine={false}
            minTickGap={60}
            hide={!showXAxis}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={(props: TickProps) => (
              <YTickRenderer {...props} format={formatY} />
            )}
            axisLine={false}
            tickLine={false}
            width={4}
            mirror
            hide={!showYAxis}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{
              r: 4,
              fill: color,
              stroke: CHART_CHROME.surface,
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default PreviewAreaChart;
