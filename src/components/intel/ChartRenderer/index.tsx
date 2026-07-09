"use client";

import { useId } from "react";
import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  PieChart,
  ScatterChart,
  Line,
  Area,
  Pie,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  type PieLabelRenderProps,
} from "recharts";
import { MULTI_SERIES_PALETTE, CHART_CHROME } from "@/lib/chart-colors";
import { decodeCurrency } from "@/lib/xrpl-helpers";
import ChartTooltip, {
  type ChartTooltipPayloadEntry,
} from "@/components/shared/ChartTooltip";
import type { Visualization } from "@/types/intel";

/* ------------------------------------------------------------------ */
/*  Shared tick chip style + formatters (matches SiteAnalytics, etc.) */
/* ------------------------------------------------------------------ */

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

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (abs > 0 && abs < 1) return n.toFixed(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtXLabel(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // ISO date / YYYY-MM-DD → "Apr 17"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  }
  // 40-char XRPL hex currency code → decode to printable ticker (USD, EUROP, …).
  // Returns the input unchanged when not decodable; we then fall through
  // to the generic truncation below.
  if (/^[0-9A-Fa-f]{40}$/.test(s)) {
    const decoded = decodeCurrency(s);
    if (decoded && decoded !== s && decoded.length <= 14) return decoded;
  }
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

/* ------------------------------------------------------------------ */
/*  Tick renderers (foreignObject pattern — matches SiteAnalytics)     */
/* ------------------------------------------------------------------ */

interface TickProps {
  x?: string | number;
  y?: string | number;
  payload?: { value: string | number };
}

function YTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject
      x={Number(x) + 4}
      y={Number(y) - 10}
      width={80}
      height={20}
      style={{ overflow: "visible" }}
    >
      <span style={{ ...TICK_BOX, display: "inline-block" }}>
        {fmtNum(Number(payload.value))}
      </span>
    </foreignObject>
  );
}

function XTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  // foreignObject reserves a 80px bounding area centered on the tick.
  // Inside, a flex row centers the inline-block label so the rounded
  // background pill hugs the actual text width instead of stretching
  // to fill 80px.
  return (
    <foreignObject
      x={Number(x) - 40}
      y={Number(y) + 4}
      width={80}
      height={20}
      style={{ overflow: "visible" }}
    >
      <div style={{ display: "flex", justifyContent: "center" }}>
        <span style={{ ...TICK_BOX, display: "inline-block" }}>
          {fmtXLabel(payload.value)}
        </span>
      </div>
    </foreignObject>
  );
}

/* ------------------------------------------------------------------ */
/*  AskTooltip — shared/ChartTooltip with /asktheledger-specific       */
/*  label formatter (decodes XRPL hex currency codes → token tickers). */
/* ------------------------------------------------------------------ */

type TooltipPayloadEntry = ChartTooltipPayloadEntry;

function AskTooltip(props: { active?: boolean; payload?: TooltipPayloadEntry[]; xKey: string }) {
  return (
    <ChartTooltip
      active={props.active}
      payload={props.payload}
      xKey={props.xKey}
      formatLabel={fmtXLabel}
      formatValue={fmtNum}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Horizontal bar + table hybrid                                      */
/*  Replaces vertical Recharts BarChart for "Top N" categorical data.  */
/*  Pattern mirrors TopDexPairs24h (network page) for site consistency. */
/* ------------------------------------------------------------------ */

function HorizontalBarTable({ viz }: { viz: Visualization }) {
  const { data, series, xAxis } = viz;
  const xKey = xAxis?.dataKey ?? "name";
  const primary = series[0];
  const secondaries = series.slice(1, 3); // up to 2 plain side metrics

  // Sort by primary numeric desc so the biggest bar leads.
  const sorted = [...data].sort((a, b) => {
    const av = Number(a[primary.dataKey]) || 0;
    const bv = Number(b[primary.dataKey]) || 0;
    return bv - av;
  });

  const maxValue = Math.max(
    ...sorted.map((r) => Math.abs(Number(r[primary.dataKey]) || 0)),
    1,
  );

  return (
    <div>
      {/* Header row — matches TopDexPairs24h pattern. Second secondary hides
          on mobile so the bar gets enough room. */}
      <div aria-hidden="true" className="mb-2 flex items-center gap-3 px-1">
        <span className="w-28 shrink-0 font-display text-tag font-medium uppercase tracking-header text-muted">
          {xAxis?.label ?? "Category"}
        </span>
        <span className="flex-1 font-display text-tag font-medium uppercase tracking-header text-muted">
          {primary.label}
        </span>
        {secondaries[0] && (
          <span className="w-16 shrink-0 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
            {secondaries[0].label}
          </span>
        )}
        {secondaries[1] && (
          <span className="hidden w-16 shrink-0 text-right font-display text-tag font-medium uppercase tracking-header text-muted md:inline-block">
            {secondaries[1].label}
          </span>
        )}
      </div>

      {/* Single-row layout at all viewports — same shape as TopDexPairs24h
          on /network. Mobile drops the second secondary metric (if any)
          to give the bar enough width to be legible. */}
      <ul className="space-y-1.5" aria-label={primary.label}>
        {sorted.map((row, i) => {
          const value = Number(row[primary.dataKey]) || 0;
          const pct = Math.max(0, (Math.abs(value) / maxValue) * 100);
          return (
            <li key={i} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate font-mono text-cell font-medium text-primary">
                {fmtXLabel(row[xKey])}
              </span>
              <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-elevated">
                <div
                  className="absolute inset-y-0 left-0 bg-brand/25"
                  style={{ width: `${pct}%` }}
                />
                <div className="relative flex h-full items-center px-2">
                  <span className="font-mono text-cell font-medium tabular-nums text-primary">
                    {fmtNum(value)}
                  </span>
                </div>
              </div>
              {secondaries[0] && (
                <span className="w-16 shrink-0 text-right font-mono text-tag tabular-nums text-muted">
                  {fmtNum(Number(row[secondaries[0].dataKey]) || 0)}
                </span>
              )}
              {secondaries[1] && (
                <span className="hidden w-16 shrink-0 text-right font-mono text-tag tabular-nums text-muted md:inline-block">
                  {fmtNum(Number(row[secondaries[1].dataKey]) || 0)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main renderer                                                      */
/* ------------------------------------------------------------------ */

function getColor(s: Visualization["series"][number], idx: number): string {
  return s.color || MULTI_SERIES_PALETTE[idx % MULTI_SERIES_PALETTE.length];
}

const CURSOR_STYLE = {
  stroke: CHART_CHROME.muted,
  strokeWidth: 1,
  strokeDasharray: "4 4",
};

/** For bar / pie charts: max chart width grows with data-point count
 *  so the chart isn't stretched to fill arbitrary container width with
 *  whitespace gaps. Time-series charts (line/area) stay full-width
 *  since denser samples actually benefit from the horizontal space. */
function computeMaxWidth(viz: Visualization): string | undefined {
  if (viz.type === "line" || viz.type === "area" || viz.type === "scatter") {
    return undefined; // full width
  }
  if (viz.type === "pie") {
    return "min(100%, 480px)";
  }
  // Bar: ~80px per category (incl. gap), with a Y-axis budget on top.
  // Clamp between 360 and 920px.
  const px = Math.max(360, Math.min(920, viz.data.length * 80 + 80));
  return `min(100%, ${px}px)`;
}

export default function ChartRenderer({ viz }: { viz: Visualization }) {
  const { type, title, data, series, xAxis, stacked } = viz;
  const xDataKey = xAxis?.dataKey ?? "name";
  const xType = (xAxis?.type ?? "category") as "number" | "category";
  const gradientId = useId();
  const maxWidth = computeMaxWidth(viz);

  const titleEl = (
    <p className="mb-3 line-clamp-2 font-display text-label font-bold uppercase tracking-header text-brand">
      {title}
    </p>
  );

  if (type === "bar") {
    // Categorical bar charts render as a horizontal bar+table hybrid —
    // see HorizontalBarTable above. No Recharts BarChart, no fixed h-64
    // height (the list grows naturally with row count).
    return (
      <div>
        {titleEl}
        <HorizontalBarTable viz={viz} />
      </div>
    );
  }

  if (type === "pie") {
    return (
      <div>
        {titleEl}
        <div className="h-64" style={maxWidth ? { maxWidth } : undefined}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey={series[0].dataKey}
                nameKey={xDataKey}
                cx="50%"
                cy="50%"
                innerRadius="50%"
                outerRadius="80%"
                strokeWidth={0}
                label={(props: PieLabelRenderProps) =>
                  `${fmtXLabel(props.name)}: ${((Number(props.percent) || 0) * 100).toFixed(0)}%`
                }
                labelLine={false}
              >
                {data.map((_: Record<string, unknown>, i: number) => (
                  <Cell key={i} fill={MULTI_SERIES_PALETTE[i % MULTI_SERIES_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip content={(props) => <AskTooltip {...(props as unknown as { active?: boolean; payload?: TooltipPayloadEntry[] })} xKey={xDataKey} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  const chartContent = type === "line" ? (
    <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid horizontal vertical={false} stroke={CHART_CHROME.elevated} />
      <XAxis
        dataKey={xDataKey}
        type={xType}
        tick={(props: TickProps) => <XTick {...props} />}
        axisLine={false}
        tickLine={false}
        minTickGap={40}
      />
      <YAxis
        tick={(props: TickProps) => <YTick {...props} />}
        axisLine={false}
        tickLine={false}
        width={4}
        mirror
      />
      <Tooltip
        content={(props) => <AskTooltip {...(props as unknown as { active?: boolean; payload?: TooltipPayloadEntry[] })} xKey={xDataKey} />}
        cursor={CURSOR_STYLE}
      />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-mono)" }} />}
      {series.map((s, i) => (
        <Line
          key={s.dataKey}
          type="monotone"
          dataKey={s.dataKey}
          name={s.label}
          stroke={getColor(s, i)}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: getColor(s, i), stroke: CHART_CHROME.surface, strokeWidth: 2 }}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  ) : type === "area" ? (
    <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={s.dataKey} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={getColor(s, i)} stopOpacity={0.3} />
            <stop offset="100%" stopColor={getColor(s, i)} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      <CartesianGrid horizontal vertical={false} stroke={CHART_CHROME.elevated} />
      <XAxis
        dataKey={xDataKey}
        type={xType}
        tick={(props: TickProps) => <XTick {...props} />}
        axisLine={false}
        tickLine={false}
        minTickGap={40}
      />
      <YAxis
        tick={(props: TickProps) => <YTick {...props} />}
        axisLine={false}
        tickLine={false}
        width={4}
        mirror
      />
      <Tooltip
        content={(props) => <AskTooltip {...(props as unknown as { active?: boolean; payload?: TooltipPayloadEntry[] })} xKey={xDataKey} />}
        cursor={CURSOR_STYLE}
      />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-mono)" }} />}
      {series.map((s, i) => (
        <Area
          key={s.dataKey}
          type="monotone"
          dataKey={s.dataKey}
          name={s.label}
          stroke={getColor(s, i)}
          strokeWidth={2}
          fill={`url(#${gradientId}-${i})`}
          // Stacked areas drop the per-series fill gradient in favor of
          // solid color so the stacking is readable; non-stacked single
          // or overlap areas keep the gradient (familiar Sonde look).
          fillOpacity={stacked ? 0.85 : undefined}
          // stackId on every series → Recharts stacks them additively.
          // Identical id across all series creates one shared stack.
          stackId={stacked ? "1" : undefined}
          dot={false}
          activeDot={{ r: 4, fill: getColor(s, i), stroke: CHART_CHROME.surface, strokeWidth: 2 }}
          isAnimationActive={false}
        />
      ))}
    </AreaChart>
  ) : (
    <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid horizontal vertical={false} stroke={CHART_CHROME.elevated} />
      <XAxis
        dataKey={xDataKey}
        type={xType}
        tick={(props: TickProps) => <XTick {...props} />}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={(props: TickProps) => <YTick {...props} />}
        axisLine={false}
        tickLine={false}
        width={4}
        mirror
      />
      <Tooltip content={(props) => <AskTooltip {...(props as unknown as { active?: boolean; payload?: TooltipPayloadEntry[] })} xKey={xDataKey} />} />
      {series.map((s, i) => (
        <Scatter key={s.dataKey} data={data} name={s.label} fill={getColor(s, i)} isAnimationActive={false} />
      ))}
    </ScatterChart>
  );

  return (
    <div>
      {titleEl}
      <div className="h-64" style={maxWidth ? { maxWidth } : undefined}>
        <ResponsiveContainer width="100%" height="100%">
          {chartContent}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
