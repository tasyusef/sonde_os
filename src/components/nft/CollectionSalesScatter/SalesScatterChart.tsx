"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CHROME } from "@/lib/chart-colors";
import { type CollectionSalePoint } from "@/lib/db-queries";

interface TooltipPayloadItem {
  payload?: CollectionSalePoint;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const date = new Date(point.timestampUnix * 1000);
  return (
    <div className="rounded-xl border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-cell font-medium tabular-nums text-primary">
        {point.priceXrp.toLocaleString(undefined, {
          maximumFractionDigits: 4,
        })}{" "}
        XRP
      </p>
      <p className="mt-0.5 font-mono text-tag text-muted">
        {date.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}

/**
 * Sales scatter — one dot per XRP-denominated trade in the chosen
 * window. X axis: time. Y axis: price in XRP. Client component
 * because recharts has to run after hydration; the parent fetches
 * the points server-side and hands them in via props.
 *
 * Y-axis is linear with a `.toLocaleString` formatter — log scale
 * would compress outliers usefully but most collections trade in a
 * narrow band so the linear view reads more naturally.
 */
export default function SalesScatterChart({
  points,
}: {
  points: CollectionSalePoint[];
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="font-mono text-tag text-muted">No XRP sales in the last 90 days.</p>
      </div>
    );
  }

  return (
    <div className="h-48 px-3 pb-3 pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={CHART_CHROME.elevated} strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="timestampUnix"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) =>
              new Date(Number(v) * 1000).toLocaleDateString(undefined, {
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
            type="number"
            dataKey="priceXrp"
            domain={["auto", "auto"]}
            tickFormatter={(v) =>
              Number(v).toLocaleString(undefined, {
                maximumFractionDigits: Number(v) < 10 ? 2 : 0,
              })
            }
            stroke={CHART_CHROME.muted}
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ stroke: CHART_CHROME.elevated, strokeWidth: 1 }}
            content={<CustomTooltip />}
          />
          <Scatter
            data={points}
            fill={CHART_CHROME.brand}
            fillOpacity={0.7}
            // Smaller dots so dense periods don't turn into a solid bar.
            shape="circle"
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
