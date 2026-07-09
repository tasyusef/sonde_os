"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CHROME } from "@/lib/chart-colors";
import { type CollectionVolumePoint } from "@/lib/db-queries";

function formatXrp(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  if (v >= 10) return v.toFixed(0);
  return v.toFixed(1);
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: CollectionVolumePoint }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const date = new Date(`${p.day}T00:00:00Z`);
  return (
    <div className="rounded-xl border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-cell font-medium tabular-nums text-primary">
        {p.volumeXrp.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
        XRP
      </p>
      <p className="mt-0.5 font-mono text-tag text-muted">
        {p.tradeCount} trade{p.tradeCount === 1 ? "" : "s"} ·{" "}
        {date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      </p>
    </div>
  );
}

/**
 * Daily XRP-denominated trade volume for the last 90 days as a bar
 * chart. Zero-filled by the server query so the timeline is
 * continuous (days without trades render as gaps, not missing bars).
 */
export default function VolumeBarChart({
  points,
}: {
  points: CollectionVolumePoint[];
}) {
  const totalVolume = points.reduce((sum, p) => sum + p.volumeXrp, 0);
  if (totalVolume === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="font-mono text-tag text-muted">
          No XRP volume in the last 90 days.
        </p>
      </div>
    );
  }

  return (
    <div className="h-48 px-3 pb-3 pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={CHART_CHROME.elevated} strokeDasharray="2 4" />
          <XAxis
            dataKey="day"
            tickFormatter={(v) =>
              new Date(`${v}T00:00:00Z`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            }
            stroke={CHART_CHROME.muted}
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={formatXrp}
            stroke={CHART_CHROME.muted}
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: CHART_CHROME.elevated, fillOpacity: 0.3 }}
            content={<CustomTooltip />}
          />
          <Bar
            dataKey="volumeXrp"
            fill={CHART_CHROME.brand}
            fillOpacity={0.85}
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
