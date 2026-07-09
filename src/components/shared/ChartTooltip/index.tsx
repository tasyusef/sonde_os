"use client";

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *\
 * Shared chart tooltip — single source of truth for Recharts tooltips
 * across the site. Replaces ~6 ad-hoc copies that drifted (`shadow-card`
 * vs `shadow-lg`, slight padding differences, custom label/value
 * rendering). Anchor the design here, vary via props.
 *
 * Usage with Recharts:
 *
 *   <Tooltip content={({ active, payload }) => (
 *     <ChartTooltip active={active} payload={payload} xKey="date" />
 *   )} />
 *
 * Or with the function-prop form when you need raw label/payload from
 * Recharts directly:
 *
 *   <Tooltip content={<ChartTooltip xKey="date" />} />
 *
 * Both work — Recharts forwards `active` / `payload` / `label` to whatever
 * component you pass to `content`.
 *
 * Specialized callers (sign-based coloring for returns, pre-formatted
 * labels, etc.) pass props rather than reimplementing the wrapper.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  Migration follow-up (started 2026-05-03, not finished)
 * ─────────────────────────────────────────────────────────────────────
 * Today's pass added this primitive + migrated `intel/ChartRenderer`
 * via the `AskTooltip` wrapper. The other chart components still have
 * their own inline tooltip impls — same shape, slightly different
 * formatting per chart, all already shadow-normalized to `shadow-card`.
 * They didn't migrate today because each one has chart-specific
 * formatting that warrants a careful per-component pass.
 *
 * **Easy migrations** (generic shape, no special coloring — just swap
 * to <ChartTooltip xKey="..." /> and verify):
 *   - components/network/TxTypeDistributionChart  (pie, simple)
 *   - components/network/ActiveWalletsChart
 *   - components/network/XRPSupplyChart
 *   - components/network/FeeBurnChart
 *   - components/network/TxVolumeChart
 *   - components/portfolio/AllocationChart/DonutView
 *   - components/portfolio/AllocationChart/TreemapView
 *   - components/portfolio/PortfolioChart
 *   - components/tokens/TokenPriceChart
 *   - components/amendments/AmendmentVoteChart
 *
 * **Needs the `valueColorBy="sign"` prop** (positive/negative coloring):
 *   - components/portfolio/MonthlyReturns
 *   - components/portfolio/RealizedPnLChart
 *
 * **Needs custom formatter props** (per-currency suffixes, custom
 * label render, etc. — pass `formatLabel` / `formatValue`):
 *   - components/network/DexVolumeChart       ("XRP" suffix on values)
 *   - components/network/AMMFeeRevenue        (XRP / USD switching)
 *   - components/network/NFTActivityChart     (volume vs count modes)
 *   - components/admin/SiteAnalytics          (3 charts, all use the
 *                                               same local ChartTooltip
 *                                               with `valueKeys` config)
 *   - components/smart-money/ScoreHistoryChart (single brand-color value)
 *   - components/smart-money/FactorBreakdown   (component-specific)
 *   - components/tokens/TokenHolders           (mode-based formatting)
 *
 * Order of operations when picking this up: easy migrations first
 * (build confidence in the API), then sign-based, then custom
 * formatters. Verify visually after each one. Do NOT batch-migrate
 * blindly — Recharts tooltip behavior is subtle and chart-specific.
\* ------------------------------------------------------------------ */

export interface ChartTooltipPayloadEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipPayloadEntry[];
  /** Recharts forwards this when present (e.g. categorical x-axis); used
   *  as a fallback when `xKey` isn't set or the payload has no underlying row. */
  label?: string | number;
  /** Read the x-axis label from this key on the payload's underlying row.
   *  Use for time-series and pivoted shapes where the row carries the date. */
  xKey?: string;
  /** Custom label formatter — receives the raw value, returns display string. */
  formatLabel?: (v: unknown) => string;
  /** Custom value formatter — receives the raw numeric, returns display string.
   *  Defaults to abbreviated (1.2K / 3.4M / 1.5B). */
  formatValue?: (v: number) => string;
  /**
   * Color the value text by:
   * - "series" (default): use each payload entry's `color` (matches series stroke).
   * - "sign": text-success for ≥ 0, text-error for < 0. Use for returns / deltas.
   * - "primary": no color variation, all values text-primary.
   */
  valueColorBy?: "series" | "sign" | "primary";
  /** Hide the unit suffix that Recharts puts in `name` on each series row.
   *  Useful when the chart has a single series and the unit is obvious from the title. */
  hideSeriesName?: boolean;
}

/** Default x-axis label formatter — handles ISO dates → "Apr 17". */
export function defaultFormatLabel(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  }
  return s;
}

/** Default numeric formatter — abbreviated K / M / B for large values,
 *  2 decimals for sub-1, comma-separated for everything in between. */
export function defaultFormatValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (abs > 0 && abs < 1) return n.toFixed(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function ChartTooltip({
  active,
  payload,
  label,
  xKey,
  formatLabel = defaultFormatLabel,
  formatValue = defaultFormatValue,
  valueColorBy = "series",
  hideSeriesName = false,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  // Resolve the label: explicit > xKey lookup on first payload's row > Recharts label.
  const firstRow = payload[0]?.payload ?? {};
  const rawLabel = xKey ? firstRow[xKey] : label;
  const labelText = formatLabel(rawLabel);

  return (
    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
      {labelText ? (
        <p className="font-mono text-label text-muted">{labelText}</p>
      ) : null}
      {payload.map((p, i) => {
        const numValue = Number(p.value);
        const signClass =
          valueColorBy === "sign"
            ? numValue >= 0
              ? "text-success"
              : "text-error"
            : "text-primary";
        const inlineStyle =
          valueColorBy === "series" && p.color ? { color: p.color } : undefined;
        return (
          <p
            key={i}
            className={cn(
              "mt-0.5 font-mono text-value font-medium tabular-nums",
              signClass,
            )}
            style={inlineStyle}
          >
            {formatValue(numValue)}
            {!hideSeriesName && p.name ? (
              <span className="ml-1 font-normal text-muted">{String(p.name)}</span>
            ) : null}
          </p>
        );
      })}
    </div>
  );
}
