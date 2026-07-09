"use client";

import { useId } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { CHART_CHROME } from "@/lib/chart-colors";

interface HistoryPoint {
  compositeScore: number;
  scoredAt: string;
}

interface ScoreHistoryChartProps {
  history: HistoryPoint[];
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

interface TickProps {
  x?: string | number;
  y?: string | number;
  payload?: { value: number | string };
}

function YTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject
      x={Number(x) + 4}
      y={Number(y) - 10}
      width={40}
      height={20}
      style={{ overflow: "visible" }}
    >
      <span style={{ ...TICK_BOX, display: "inline-block" }}>
        {payload.value}
      </span>
    </foreignObject>
  );
}

function XTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  const d = new Date(payload.value);
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <foreignObject
      x={Number(x) - 30}
      y={Number(y) + 4}
      width={60}
      height={20}
      style={{ overflow: "visible" }}
    >
      <span style={{ ...TICK_BOX, display: "block", textAlign: "center" }}>
        {label}
      </span>
    </foreignObject>
  );
}

/**
 * Score history chart body. Renders without its own card chrome —
 * the parent (`WalletDetailPage`) wraps it in a `CollapsibleCard`
 * that supplies the "Score History" title and the collapsible
 * animation. Same pattern as `FactorBreakdown` + `HoldingsTable`.
 */
export default function ScoreHistoryChart({ history }: ScoreHistoryChartProps) {
  const gradientId = useId();

  if (history.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="font-body text-ui text-muted">
          Need at least 2 scoring runs to show trend.
        </p>
      </div>
    );
  }

  const data = history.map((h) => ({
    date: h.scoredAt,
    score: h.compositeScore,
  }));

  return (
    // Chart wrapper has an explicit `h-72` (288px) — recharts'
    // ResponsiveContainer measures its parent's height and renders
    // accordingly, but inside CollapsibleCard the chain ends in a
    // motion.div that animates height: auto. With auto height the
    // container reads 0 and the chart never paints. Fixed-height
    // wrapper breaks the circular measurement.
    <div className="h-72 px-4 py-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="date"
              tick={(props: TickProps) => <XTick {...props} />}
              axisLine={false}
              tickLine={false}
              tickMargin={0}
              minTickGap={60}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={(props: TickProps) => <YTick {...props} />}
              axisLine={false}
              tickLine={false}
              tickMargin={0}
              width={4}
              mirror
            />

            {/* Threshold lines */}
            <ReferenceLine y={80} stroke="var(--color-success)" strokeDasharray="4 4" strokeOpacity={0.4} />
            <ReferenceLine y={60} stroke={CHART_CHROME.brand} strokeDasharray="4 4" strokeOpacity={0.4} />

            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as { date: string; score: number };
                const dateStr = new Date(d.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                });
                return (
                  <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                    <p className="font-mono text-cell text-muted">{dateStr}</p>
                    <p className="font-mono text-cell font-semibold tabular-nums text-brand">
                      Score: {d.score.toFixed(1)}
                    </p>
                  </div>
                );
              }}
            />

            <Area
              type="monotone"
              dataKey="score"
              stroke="var(--color-brand)"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
    </div>
  );
}
