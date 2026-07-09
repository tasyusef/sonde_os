"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CHART_CHROME } from "@/lib/chart-colors";
import Toggle from "@/components/shared/Toggle";

/* ——— Y-axis pill tick (matches PortfolioChart pattern) ——— */

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
  payload?: { value: number };
}

function YTick({ x, y, payload, mode }: TickProps & { mode: ValueMode }) {
  if (x == null || y == null || !payload) return null;
  const label =
    mode === "pct"
      ? `${payload.value >= 0 ? "+" : ""}${payload.value.toFixed(0)}%`
      : formatVolume(payload.value);
  return (
    <foreignObject
      x={Number(x) + 4}
      y={Number(y) - 10}
      width={100}
      height={20}
      style={{ overflow: "visible" }}
    >
      <span style={{ ...TICK_BOX, display: "inline-block" }}>{label}</span>
    </foreignObject>
  );
}

interface Snapshot {
  time: string;
  xrpBalance: number;
  xrpPriceUsd: number;
  tokenValueUsd: number;
  ammValueUsd: number;
  lockedXrp: number;
  totalValueUsd: number;
}

interface HistoryResponse {
  snapshots: Snapshot[];
}

type ValueMode = "pct" | "usd";
type TimePeriod = "daily" | "weekly" | "monthly" | "3m" | "1y";

interface Bucket {
  label: string;
  pct: number;
  usd: number;
}

const TIME_PERIODS: { value: TimePeriod; label: string }[] = [
  { value: "daily", label: "D" },
  { value: "weekly", label: "W" },
  { value: "monthly", label: "M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
];

const VALUE_MODES: { value: ValueMode; label: string }[] = [
  { value: "pct", label: "%" },
  { value: "usd", label: "$" },
];

/* ——— ISO week number ——— */
function getISOWeekKey(d: Date): string {
  const tmp = new Date(d.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${tmp.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/* ——— Generalized bucketing ——— */
function bucketByPeriod(snapshots: Snapshot[], period: TimePeriod): Bucket[] {
  if (snapshots.length < 2) return [];

  const grouped = new Map<string, Snapshot[]>();

  for (const s of snapshots) {
    const d = new Date(s.time);
    let key: string;

    switch (period) {
      case "daily":
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        break;
      case "weekly":
        key = getISOWeekKey(d);
        break;
      case "monthly":
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        break;
      case "3m": {
        const q = Math.floor(d.getMonth() / 3) + 1;
        key = `${d.getFullYear()}-Q${q}`;
        break;
      }
      case "1y":
        key = String(d.getFullYear());
        break;
    }

    const arr = grouped.get(key) ?? [];
    arr.push(s);
    grouped.set(key, arr);
  }

  const sorted = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  const buckets: Bucket[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const [key, snaps] = sorted[i];
    const first = i === 0 ? snaps[0] : sorted[i - 1][1][sorted[i - 1][1].length - 1];
    const last = snaps[snaps.length - 1];

    // Time-Weighted Return (Modified Dietz): isolate price gains from deposits/withdrawals.
    // Estimate cash flow as balance delta × average price across the sub-period.
    const startVal = first.totalValueUsd;
    const endVal = last.totalValueUsd;
    const avgXrpPrice = (first.xrpPriceUsd + last.xrpPriceUsd) / 2;
    const xrpBalanceDelta = last.xrpBalance - first.xrpBalance;
    const lockedDelta = last.lockedXrp - first.lockedXrp;
    const cashFlow = (xrpBalanceDelta + lockedDelta) * avgXrpPrice;
    const usdChange = endVal - startVal - cashFlow;
    const adjustedStart = startVal + cashFlow * 0.5; // Modified Dietz: assume mid-period flow
    const pctChange = adjustedStart > 0 ? (usdChange / adjustedStart) * 100 : 0;

    let label: string;
    switch (period) {
      case "daily": {
        const [, m, day] = key.split("-");
        const d = new Date(Number(key.slice(0, 4)), Number(m) - 1, Number(day));
        label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        break;
      }
      case "weekly": {
        const d = new Date(snaps[0].time);
        label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        break;
      }
      case "monthly": {
        const [year, month] = key.split("-");
        const d = new Date(Number(year), Number(month) - 1);
        label = d.toLocaleDateString("en-US", { month: "short" });
        break;
      }
      case "3m":
        label = key.split("-")[1]; // "Q1", "Q2", etc.
        break;
      case "1y":
        label = key; // "2025", "2026"
        break;
    }

    buckets.push({ label, pct: pctChange, usd: usdChange });
  }

  return buckets;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { payload: Bucket }[];
  mode: ValueMode;
}

function ChartTooltip({ active, payload, mode }: CustomTooltipProps) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  const value = mode === "pct" ? `${d.pct >= 0 ? "+" : ""}${d.pct.toFixed(2)}%` : `${d.usd >= 0 ? "+" : ""}${formatVolume(d.usd)}`;
  return (
    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-cell font-medium text-primary">{d.label}</p>
      <p className={cn("font-mono text-tag font-semibold tabular-nums", (mode === "pct" ? d.pct : d.usd) >= 0 ? "text-success" : "text-error")}>
        {value}
      </p>
    </div>
  );
}

const PERIOD_LABELS: Record<TimePeriod, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  "3m": "quarterly",
  "1y": "yearly",
};

export default function ReturnsChart() {
  const [valueMode, setValueMode] = useState<ValueMode>("pct");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("daily");

  const { data } = useSWR<HistoryResponse>(
    CACHE_KEYS.portfolioHistory("all"),
    fetcher,
  );

  const buckets = useMemo(
    () => (data ? bucketByPeriod(data.snapshots, timePeriod) : []),
    [data, timePeriod],
  );

  // Don't render at all if no snapshot data
  if (!data || data.snapshots.length < 2) return null;

  const hasBuckets = buckets.length >= 2;
  const dataKey = valueMode === "pct" ? "pct" : "usd";

  return (
    <div className="flex h-full flex-col rounded-2xl shadow-card bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Returns
        </span>
        <div className="flex items-center gap-3">
          <Toggle
            options={TIME_PERIODS}
            active={timePeriod}
            onChange={setTimePeriod}
          />
          <Toggle
            options={VALUE_MODES}
            active={valueMode}
            onChange={setValueMode}
          />
        </div>
      </div>

      {/* Chart or insufficient data message */}
      {hasBuckets ? (
        <div className="h-56 px-4 py-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fontFamily: "var(--font-mono)", fill: CHART_CHROME.muted }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={32}
              />
              <YAxis
                tick={(props: TickProps) => <YTick {...props} mode={valueMode} />}
                axisLine={false}
                tickLine={false}
                tickMargin={0}
                width={4}
                mirror
              />
              <ReferenceLine y={0} stroke={CHART_CHROME.elevated} />
              <Tooltip
                content={<ChartTooltip mode={valueMode} />}
                cursor={{ fill: "transparent" }}
              />
              <Bar dataKey={dataKey} radius={[3, 3, 0, 0]} maxBarSize={32}>
                {buckets.map((b, i) => (
                  <Cell
                    key={i}
                    fill={b[dataKey] >= 0 ? "var(--color-success)" : "var(--color-error)"}
                    opacity={0.7}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-4 py-8">
          <p className="font-mono text-cell text-muted">
            Not enough data for {PERIOD_LABELS[timePeriod]} view
          </p>
        </div>
      )}
    </div>
  );
}
