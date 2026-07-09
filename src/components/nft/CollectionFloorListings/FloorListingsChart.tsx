"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
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
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
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
      <p className="font-mono text-tag text-muted">
        {date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      </p>
      <p className="mt-1 font-mono text-cell tabular-nums text-primary">
        Floor:{" "}
        {p.floorXrp > 0
          ? `${formatNum(p.floorXrp)} XRP`
          : "—"}
      </p>
      <p className="font-mono text-cell tabular-nums text-primary">
        Listings: {p.listingCount}
      </p>
    </div>
  );
}

/**
 * Floor + listings combo chart for the collection. Bars are the
 * daily listing count (right Y axis), line is the daily floor price
 * in XRP (left Y axis). Both metrics read from
 * `nft_collection_daily_snapshots` — data starts accumulating from
 * when the snapshot pipeline first ran for the collection, so the
 * chart will be sparse for the first few days after launch.
 *
 * Days with no snapshot or no XRP listings render floor=0 — the line
 * has a `connectNulls={false}` so gaps show as discontinuities
 * rather than being interpolated through.
 */
export default function FloorListingsChart({
  points,
}: {
  points: CollectionDailySnapshot[];
}) {
  const hasFloor = points.some((p) => p.floorXrp > 0);
  const hasListings = points.some((p) => p.listingCount > 0);
  if (!hasFloor && !hasListings) {
    return (
      <div className="flex h-40 items-center justify-center px-3 text-center">
        <p className="font-mono text-tag text-muted">
          Snapshot data accumulating — check back in a few days.
        </p>
      </div>
    );
  }

  // Floor=0 means "no XRP listings that day" — render as null so the
  // line breaks rather than dipping through the X axis.
  const data = points.map((p) => ({
    ...p,
    floorXrpDisplay: p.floorXrp > 0 ? p.floorXrp : null,
  }));

  return (
    <div className="h-56 px-3 pb-3 pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
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
            yAxisId="left"
            tickFormatter={formatNum}
            stroke={CHART_CHROME.muted}
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={formatNum}
            stroke={CHART_CHROME.muted}
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            cursor={{ fill: CHART_CHROME.elevated, fillOpacity: 0.3 }}
            content={<CustomTooltip />}
          />
          <Bar
            yAxisId="right"
            dataKey="listingCount"
            fill={CHART_CHROME.elevated}
            fillOpacity={0.9}
            radius={[2, 2, 0, 0]}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="floorXrpDisplay"
            stroke={CHART_CHROME.brand}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
