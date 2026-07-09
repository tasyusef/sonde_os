"use client";

import { useId } from "react";
import useSWR from "swr";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { fetcher } from "@/lib/swr-config";
import { formatVolume } from "@/lib/format";
import { CHART_CHROME } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

interface PnLPoint {
  time: string;
  dailyPnl: number;
  cumulativePnl: number;
}

interface RealizedResponse {
  points: PnLPoint[];
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
      width={100}
      height={20}
      style={{ overflow: "visible" }}
    >
      <span style={{ ...TICK_BOX, display: "inline-block" }}>
        {formatVolume(Number(payload.value))}
      </span>
    </foreignObject>
  );
}

function XTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  const d = new Date(payload.value);
  const label = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
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

export default function RealizedPnLChart() {
  const gradId = useId();
  const { data } = useSWR<RealizedResponse>(
    "/api/portfolio/realized-history",
    fetcher,
  );

  if (!data || data.points.length < 2) return null;

  const lastPoint = data.points[data.points.length - 1];
  const totalPnl = lastPoint.cumulativePnl;
  const positive = totalPnl >= 0;

  return (
    <div className="flex h-full flex-col rounded-2xl shadow-card bg-surface">
      <div className="flex items-center justify-between border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Realized PnL
        </span>
        <span
          className={cn(
            "font-mono text-label font-semibold tabular-nums",
            positive ? "text-success" : "text-error",
          )}
        >
          {positive ? "+" : ""}
          {formatVolume(totalPnl)}
        </span>
      </div>

      <div className="min-h-0 flex-1 px-4 py-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data.points}
            margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={positive ? "var(--color-success)" : "var(--color-error)"}
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor={positive ? "var(--color-success)" : "var(--color-error)"}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tick={(props: TickProps) => <XTick {...props} />}
              axisLine={false}
              tickLine={false}
              tickMargin={0}
              minTickGap={60}
            />
            <YAxis
              tick={(props: TickProps) => <YTick {...props} />}
              axisLine={false}
              tickLine={false}
              tickMargin={0}
              width={4}
              mirror
            />
            <ReferenceLine y={0} stroke={CHART_CHROME.elevated} strokeDasharray="3 3" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as PnLPoint;
                const dateStr = new Date(d.time).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                });
                return (
                  <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                    <p className="font-mono text-cell text-muted">{dateStr}</p>
                    <p
                      className={cn(
                        "font-mono text-cell font-semibold tabular-nums",
                        d.cumulativePnl >= 0 ? "text-success" : "text-error",
                      )}
                    >
                      Cumulative: {d.cumulativePnl >= 0 ? "+" : ""}
                      {formatVolume(d.cumulativePnl)}
                    </p>
                    <p
                      className={cn(
                        "font-mono text-tag tabular-nums",
                        d.dailyPnl >= 0 ? "text-success/70" : "text-error/70",
                      )}
                    >
                      Day: {d.dailyPnl >= 0 ? "+" : ""}
                      {formatVolume(d.dailyPnl)}
                    </p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="cumulativePnl"
              stroke={positive ? "var(--color-success)" : "var(--color-error)"}
              strokeWidth={2}
              fill={`url(#${gradId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
