"use client";

import { useId } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CHART_CHROME } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import type { DailyPoint } from "./types";
import { fmtDate, fmtUsdShort, XTick, YTick } from "./formatters";

const COLORS = CHART_CHROME;

export default function DailyTrend({ daily, loading }: { daily: DailyPoint[]; loading: boolean }) {
  const queriesGradientId = useId();

  return (
    <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
      <p className="mb-3 font-display text-label font-bold uppercase tracking-header text-brand">
        Daily Queries (Last 30 Days)
      </p>
      <div className={cn("transition-opacity", loading ? "opacity-40" : "opacity-100")}>
        {daily.length < 2 ? (
          <div className="flex h-[220px] items-center justify-center">
            <p className="font-mono text-body text-muted">{loading ? "Loading..." : "No data"}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={queriesGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.brand} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={COLORS.brand} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid horizontal vertical={false} stroke={COLORS.elevated} />
              <XAxis
                dataKey="date"
                tick={(props) => <XTick {...props} />}
                axisLine={false}
                tickLine={false}
                minTickGap={60}
              />
              <YAxis
                tick={(props) => <YTick {...props} />}
                axisLine={false}
                tickLine={false}
                width={4}
                mirror
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as DailyPoint;
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="font-mono text-label text-muted">{fmtDate(d.date)}</p>
                      <p className="font-mono text-value font-medium text-primary">{d.queries} queries</p>
                      <p className="font-mono text-label text-muted">{fmtUsdShort(d.costUsd)} cost</p>
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="queries"
                stroke={COLORS.brand}
                strokeWidth={2}
                fill={`url(#${queriesGradientId})`}
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
