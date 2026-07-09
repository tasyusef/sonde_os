"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CHROME } from "@/lib/chart-colors";
import { type CollectionDailySnapshot } from "@/lib/db-queries";

function formatNum(v: number): string {
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
  payload?: Array<{ payload?: CollectionDailySnapshot }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const date = new Date(`${p.day}T00:00:00Z`);
  return (
    <div className="rounded-xl border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-cell font-medium tabular-nums text-primary">
        {p.holderCount.toLocaleString()} holders
      </p>
      <p className="mt-0.5 font-mono text-tag text-muted">
        {date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      </p>
    </div>
  );
}

/**
 * Unique-holder count over time. Area chart over the past 90 days
 * of daily snapshots. Sparse for the first few days after launch
 * since the snapshot pipeline only writes one row per day; data
 * fills in retroactively if/when we backfill.
 *
 * `connectNulls=false` so days without a snapshot show as
 * discontinuities rather than interpolating misleading values
 * through gaps.
 */
export default function HoldersOverTimeChart({
  points,
}: {
  points: CollectionDailySnapshot[];
}) {
  const hasAny = points.some((p) => p.holderCount > 0);
  if (!hasAny) {
    return (
      <div className="flex h-40 items-center justify-center px-3 text-center">
        <p className="font-mono text-tag text-muted">
          Snapshot data accumulating — check back in a few days.
        </p>
      </div>
    );
  }

  const data = points.map((p) => ({
    ...p,
    holderCountDisplay: p.holderCount > 0 ? p.holderCount : null,
  }));

  return (
    <div className="h-48 px-3 pb-3 pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="holders-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_CHROME.brand} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_CHROME.brand} stopOpacity={0} />
            </linearGradient>
          </defs>
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
            tickFormatter={formatNum}
            stroke={CHART_CHROME.muted}
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            width={44}
            domain={["auto", "auto"]}
          />
          <Tooltip
            cursor={{ stroke: CHART_CHROME.elevated, strokeWidth: 1 }}
            content={<CustomTooltip />}
          />
          <Area
            type="monotone"
            dataKey="holderCountDisplay"
            stroke={CHART_CHROME.brand}
            strokeWidth={2}
            fill="url(#holders-fill)"
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
