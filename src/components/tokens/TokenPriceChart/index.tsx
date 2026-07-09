"use client";

import { useState, useId } from "react";
import useSWR from "swr";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Toggle from "@/components/shared/Toggle";
import Watermark from "@/components/shared/Watermark";
import { CACHE_KEYS } from "@/lib/swr-config";
import { formatXrpValue } from "@/lib/format";
import type { OHLCPoint } from "@/types/token";

type Period = "7d" | "30d" | "90d" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

import { CHART_CHROME } from "@/lib/chart-colors";

const COLORS = CHART_CHROME;

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

function formatPrice(price: number): string {
  if (price === 0) return "0";
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.001) return price.toFixed(6);
  return price.toPrecision(4);
}

function formatPriceTick(price: number): string {
  if (price >= 1_000_000) return `${(price / 1_000_000).toFixed(1)}M`;
  if (price >= 1_000) return `${(price / 1_000).toFixed(1)}K`;
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  return price.toPrecision(3);
}


function formatDateTick(ts: number, showTime: boolean): string {
  const d = new Date(ts);
  if (showTime) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface TickProps {
  x?: string | number;
  y?: string | number;
  payload?: { value: number };
}

function YTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) + 4} y={Number(y) - 10} width={90} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "inline-block" }}>{formatPriceTick(payload.value)}</span>
    </foreignObject>
  );
}

function XTick({ x, y, payload, showTime }: TickProps & { showTime: boolean }) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) - 40} y={Number(y) + 4} width={80} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "block", textAlign: "center" }}>
        {formatDateTick(payload.value, showTime)}
      </span>
    </foreignObject>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

interface Props {
  currency: string;
  issuer: string;
  currencyDisplay: string;
  currentPrice: number | null;
}

export function TokenPriceChart({ currency, issuer, currencyDisplay, currentPrice }: Props) {
  const gradientId = useId();
  const [period, setPeriod] = useState<Period>("7d");

  const { data: raw, isLoading, isValidating } = useSWR<{
    data: OHLCPoint[];
  }>(CACHE_KEYS.tokenOhlc(currency, issuer, period));

  const loading = isLoading || isValidating;
  const data = raw?.data ?? [];

  const showTime = period === "7d";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-surface shadow-card">
      <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            {currencyDisplay} / XRP Price
          </span>
          {currentPrice != null && (
            <div className="mt-1">
              <span className="font-mono text-value font-medium tabular-nums text-primary">
                {formatPrice(currentPrice)} XRP
              </span>
            </div>
          )}
        </div>
        <Toggle options={PERIODS} active={period} onChange={setPeriod} />
      </div>

      <div className={`relative min-h-[280px] flex-1 p-4 transition-opacity ${loading ? "opacity-40" : "opacity-100"}`}>
        {/* Watermark */}
        <Watermark />

        {data.length < 2 ? (
          <div className="flex h-full min-h-[240px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading price data..." : "No price data available"}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.brand} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={COLORS.brand} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid horizontal vertical={false} stroke={COLORS.elevated} />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={["dataMin", "dataMax"]}
                scale="time"
                tick={(props: TickProps) => <XTick {...props} showTime={showTime} />}
                axisLine={false}
                tickLine={false}
                minTickGap={60}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={(props: TickProps) => <YTick {...props} />}
                axisLine={false}
                tickLine={false}
                width={4}
                mirror
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload as OHLCPoint;
                  if (!d) return null;
                  return (
                    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                      <p className="font-mono text-label text-muted">
                        {new Date(d.timestamp).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          ...(showTime ? { hour: "numeric", minute: "2-digit" } : {}),
                        })}
                      </p>
                      <p className="font-mono text-value font-medium text-primary">
                        {formatPrice(d.close)} XRP
                      </p>
                      <p className="font-mono text-cell text-muted">
                        Vol: {formatXrpValue(d.volume)} XRP &middot; {d.tradeCount.toLocaleString()} trades
                      </p>
                      {d.isVwap && (
                        <p className="font-mono text-label text-muted italic">VWAP estimate</p>
                      )}
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={COLORS.brand}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
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

export default TokenPriceChart;
