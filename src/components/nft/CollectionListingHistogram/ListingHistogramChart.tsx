"use client";

import { useMemo } from "react";
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

const BUCKET_COUNT = 10;

interface Bucket {
  /** Lower bound of the bucket (inclusive), in XRP. */
  lower: number;
  /** Upper bound of the bucket (exclusive, except for the last). */
  upper: number;
  /** Number of listings whose price falls in [lower, upper). */
  count: number;
  /** Label rendered on the y axis. */
  label: string;
}

function formatPrice(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function buildBuckets(prices: number[]): Bucket[] {
  if (prices.length === 0) return [];

  // Sort once and clip the top 1% so a few wildly-priced outliers
  // don't compress the rest of the distribution into the leftmost
  // bucket. Display value is the still the full count of clipped
  // listings at the top-bucket label.
  const sorted = [...prices].sort((a, b) => a - b);
  const min = sorted[0];
  const clipIdx = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * 0.99),
  );
  const max = sorted[clipIdx];

  if (max <= min) {
    // All listings at the same price — show as a single bar.
    return [
      {
        lower: min,
        upper: max,
        count: prices.length,
        label: formatPrice(min),
      },
    ];
  }

  const step = (max - min) / BUCKET_COUNT;
  const buckets: Bucket[] = [];
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const lower = min + step * i;
    const upper = i === BUCKET_COUNT - 1 ? Infinity : min + step * (i + 1);
    buckets.push({ lower, upper, count: 0, label: formatPrice(lower) });
  }

  for (const p of prices) {
    let idx = Math.floor((p - min) / step);
    if (idx >= BUCKET_COUNT) idx = BUCKET_COUNT - 1;
    if (idx < 0) idx = 0;
    buckets[idx].count++;
  }

  return buckets;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Bucket }>;
}) {
  if (!active || !payload?.length) return null;
  const b = payload[0]?.payload;
  if (!b) return null;
  const range =
    b.upper === Infinity
      ? `≥ ${formatPrice(b.lower)} XRP`
      : `${formatPrice(b.lower)}–${formatPrice(b.upper)} XRP`;
  return (
    <div className="rounded-xl border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-cell font-medium tabular-nums text-primary">
        {b.count} listing{b.count === 1 ? "" : "s"}
      </p>
      <p className="mt-0.5 font-mono text-tag text-muted">{range}</p>
    </div>
  );
}

/**
 * Horizontal-bar histogram of open sell-offer prices. Each bar is a
 * fixed-width XRP price bin; the length of the bar is the count of
 * listings falling in that bin. Top 1% of prices clipped so a single
 * outlier doesn't compress the visible distribution into one bar.
 *
 * Layout uses recharts `layout="vertical"` (horizontal bars). Y axis
 * carries the bin label (lower bound), X axis carries the count.
 */
export default function ListingHistogramChart({
  prices,
}: {
  prices: number[];
}) {
  const buckets = useMemo(() => buildBuckets(prices), [prices]);

  if (buckets.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="font-mono text-tag text-muted">No active XRP listings.</p>
      </div>
    );
  }

  return (
    <div className="h-56 px-3 pb-3 pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={buckets}
          layout="vertical"
          margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
        >
          <CartesianGrid
            stroke={CHART_CHROME.elevated}
            strokeDasharray="2 4"
            horizontal={false}
          />
          <XAxis
            type="number"
            allowDecimals={false}
            stroke={CHART_CHROME.muted}
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            stroke={CHART_CHROME.muted}
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            width={48}
            reversed
          />
          <Tooltip
            cursor={{ fill: CHART_CHROME.elevated, fillOpacity: 0.3 }}
            content={<CustomTooltip />}
          />
          <Bar
            dataKey="count"
            fill={CHART_CHROME.brand}
            fillOpacity={0.85}
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
