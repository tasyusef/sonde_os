"use client";

import { useId, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Watermark from "@/components/shared/Watermark";
import type { DepthLevel } from "@/types/token";

interface DepthChartProps {
  bids: DepthLevel[];
  asks: DepthLevel[];
}

function formatPrice(n: number): string {
  if (n < 0.0001) return n.toExponential(1);
  if (n < 1) return n.toFixed(4);
  return n.toFixed(2);
}

function formatAmount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

interface ChartPoint {
  price: number;
  bid: number | null;
  ask: number | null;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  const side = point.dataKey === "bid" ? "Bid" : "Ask";
  const color =
    point.dataKey === "bid" ? "var(--color-success)" : "var(--color-error)";

  return (
    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-label text-muted">{side} Depth</p>
      <p className="font-mono text-cell font-medium" style={{ color }}>
        {formatAmount(point.value)} tokens
      </p>
    </div>
  );
}

export default function DepthChart({ bids, asks }: DepthChartProps) {
  const id = useId();
  const bidGradient = `bid-grad-${id}`;
  const askGradient = `ask-grad-${id}`;

  const data = useMemo<ChartPoint[]>(() => {
    // Bids: show from lowest price to highest (reversed so chart reads left-to-right)
    const bidPoints: ChartPoint[] = [...bids]
      .reverse()
      .map((b) => ({ price: b.price, bid: b.cumulativeAmount, ask: null }));

    const askPoints: ChartPoint[] = asks.map((a) => ({
      price: a.price,
      bid: null,
      ask: a.cumulativeAmount,
    }));

    return [...bidPoints, ...askPoints];
  }, [bids, asks]);

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center">
        <p className="font-mono text-body text-muted">
          No orderbook data available
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Watermark />
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={bidGradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={askGradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-error)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--color-error)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="price"
            tickFormatter={formatPrice}
            tick={{
              fill: "var(--color-muted)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatAmount}
            tick={{
              fill: "var(--color-muted)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
            axisLine={false}
            tickLine={false}
            width={4}
            mirror
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "var(--color-muted)", strokeDasharray: "4 4" }}
          />
          <Area
            type="stepAfter"
            dataKey="bid"
            stroke="var(--color-success)"
            fill={`url(#${bidGradient})`}
            strokeWidth={1.5}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Area
            type="stepAfter"
            dataKey="ask"
            stroke="var(--color-error)"
            fill={`url(#${askGradient})`}
            strokeWidth={1.5}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export { DepthChart };
