"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import Toggle from "@/components/shared/Toggle";
import Watermark from "@/components/shared/Watermark";
import { fetcher } from "@/lib/swr-config";
import type { AmendmentVotePoint } from "@/types/amendments";

const PERIODS = [
  { value: "7d" as const, label: "7D" },
  { value: "30d" as const, label: "30D" },
  { value: "90d" as const, label: "90D" },
  { value: "all" as const, label: "All" },
];

type Period = "7d" | "30d" | "90d" | "all";

const COLORS = {
  brand: "var(--color-brand)",
  muted: "var(--color-muted)",
  elevated: "var(--color-elevated)",
  surface: "var(--color-surface)",
  primary: "var(--color-primary)",
};

interface AmendmentVoteChartProps {
  hash: string;
  initialHistory?: AmendmentVotePoint[];
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AmendmentVoteChart({
  hash,
  initialHistory,
}: AmendmentVoteChartProps) {
  const [period, setPeriod] = useState<Period>("30d");
  const { data: swrData, isLoading } = useSWR<{ history: AmendmentVotePoint[] }>(
    `/api/amendments/${hash}?period=${period}`,
    fetcher,
    { fallbackData: initialHistory ? { history: initialHistory } : undefined },
  );
  const data = swrData?.history ?? [];
  const loading = isLoading;
  const hasData = data.length > 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-end">
        <Toggle options={PERIODS} active={period} onChange={setPeriod} />
      </div>

      <div className="relative min-h-[200px]">
        <Watermark />
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/50">
            <p className="font-mono text-cell text-muted">Loading...</p>
          </div>
        )}

        {!hasData && !loading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <p className="font-mono text-cell text-muted">
              No vote history data yet
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart
              data={data}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id={`grad-${hash}`} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={COLORS.brand}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="100%"
                    stopColor={COLORS.brand}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>

              <XAxis
                dataKey="timestamp"
                tickFormatter={formatDate}
                stroke={COLORS.muted}
                fontSize={11}
                fontFamily="var(--font-mono)"
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />

              <YAxis
                domain={[0, 100]}
                ticks={[0, 20, 40, 60, 80, 100]}
                tickFormatter={(v: number) => `${v}%`}
                stroke={COLORS.muted}
                fontSize={11}
                fontFamily="var(--font-mono)"
                tickLine={false}
                axisLine={false}
                width={40}
              />

              <ReferenceLine
                y={80}
                stroke={COLORS.muted}
                strokeDasharray="4 4"
                strokeOpacity={0.6}
                label={{
                  value: "80%",
                  position: "right",
                  fill: COLORS.muted,
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                }}
              />

              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as AmendmentVotePoint;
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="font-mono text-label text-muted">
                        {formatDateTime(d.timestamp)}
                      </p>
                      <p className="mt-1 font-mono text-cell font-medium text-primary">
                        {d.yesCount} / {d.totalValidators} validators ({d.percent}%)
                      </p>
                      <p className="font-mono text-label text-muted">
                        Threshold: {d.threshold}
                      </p>
                    </div>
                  );
                }}
              />

              <Area
                type="monotone"
                dataKey="percent"
                stroke={COLORS.brand}
                strokeWidth={2}
                fill={`url(#grad-${hash})`}
                dot={false}
                activeDot={{
                  r: 3,
                  stroke: COLORS.brand,
                  strokeWidth: 2,
                  fill: COLORS.surface,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default AmendmentVoteChart;
