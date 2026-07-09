"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { formatVolume } from "@/lib/format";
import type { SliceData } from "./types";

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: SliceData }[];
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-cell font-medium text-primary">{d.name}</p>
      <p className="font-mono text-tag text-muted">
        {formatVolume(d.value)} ({d.percentage.toFixed(1)}%)
      </p>
    </div>
  );
}

export default function DonutView({
  slices,
  totalValueUsd,
  maxValue,
}: {
  slices: SliceData[];
  totalValueUsd: number;
  maxValue: number;
}) {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      {/* Donut */}
      <div
        className="relative h-[180px] w-[180px] shrink-0"
        role="img"
        aria-label={`Portfolio allocation donut chart, total ${formatVolume(totalValueUsd)}`}
      >
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center">
          <span className="font-mono text-heading font-medium tabular-nums text-primary">
            {formatVolume(totalValueUsd)}
          </span>
          <span className="font-mono text-tag text-muted">total</span>
        </div>
        <div className="relative z-10">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={slices} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" stroke="none">
                {slices.map((entry, i) => (
                  <Cell key={`${entry.name}-${i}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Legend with proportion bars */}
      <div className="flex-1 space-y-2.5">
        {slices.map((d, i) => (
          <div key={`${d.name}-${i}`} className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
                <span className="font-mono text-cell font-medium text-primary">{d.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-cell tabular-nums text-secondary">{formatVolume(d.value)}</span>
                <span className="w-[50px] text-right font-mono text-tag tabular-nums text-muted">
                  {d.percentage.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${(d.value / maxValue) * 100}%`, backgroundColor: d.color, opacity: 0.6 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
