"use client";

import { Card, PreviewAreaChart } from "@/components/shared/PreviewPrimitives";
import { cn } from "@/lib/utils";

/* ————————————————————————————————————————————
   Active accounts trend tweet card.

   Tweet format: 14-day sparkline of unique active wallets with a hero
   showing the current-period daily average and a % delta comparing it
   to the prior 14-day period's average. Accepts 28 days of data so the
   comparison is period-over-period rather than start-vs-end.
   ———————————————————————————————————————————— */

export interface ActiveAccountsCardProps {
  /** Daily active account counts, ordered oldest → newest. 28 days expected
   * — the card slices into current 14d (shown) and prior 14d (for delta). */
  trend: { day: string; count: number }[];
  /** Period label shown in header */
  period?: string;
}

// Deterministic demo data — same output on every call, on both server
// and client. Earlier versions used Math.random() + new Date() at
// module init time, which produced different arrays during SSR vs
// hydration and tripped React's hydration warning. Real consumers
// always pass live trend data; the demo is just a preview placeholder.
function makeDemoTrend(): { day: string; count: number }[] {
  const base = 42_000;
  const days: { day: string; count: number }[] = [];
  const baseDate = new Date("2025-08-23T00:00:00Z");
  for (let i = 27; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() - i);
    const noise = Math.round(Math.sin(i * 0.71) * 1_400);
    const growth = Math.round((27 - i) * 140);
    days.push({
      day: d.toISOString().slice(0, 10),
      count: base + growth + noise,
    });
  }
  return days;
}

const DEFAULT_PROPS: ActiveAccountsCardProps = {
  trend: makeDemoTrend(),
  period: "14D",
};

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

export function ActiveAccountsCard(
  props: Partial<ActiveAccountsCardProps> = {},
) {
  const { trend, period } = { ...DEFAULT_PROPS, ...props };

  const sorted = [...trend].sort(
    (a, b) => new Date(a.day).getTime() - new Date(b.day).getTime(),
  );

  // Split into prior period (older half) + current period (newer half). When
  // fewer than 28 days are available, fall back to showing whatever we have
  // and report a zero delta — better than crashing or spiking a fake %.
  const splitAt = Math.max(0, sorted.length - 14);
  const priorWindow = sorted.slice(0, splitAt);
  const currentWindow = sorted.slice(splitAt);

  const currentAvg = avg(currentWindow.map((d) => d.count));
  const priorAvg = avg(priorWindow.map((d) => d.count));
  const delta =
    priorAvg > 0 ? ((currentAvg - priorAvg) / priorAvg) * 100 : 0;
  const deltaPositive = delta >= 0;

  // Sparkline spans the full 28-day window so the reader sees the prior
  // period too — the chart gives visual context for the % delta above.
  const chartData = sorted.map((d) => ({
    timestamp: new Date(d.day).getTime(),
    value: d.count,
  }));

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          Active Accounts
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted">
          {period}
        </span>
      </div>

      {/* Hero number + delta */}
      <div className="px-6 py-6 text-center">
        <div className="font-mono text-display-lg font-medium tabular-nums text-primary">
          {formatCount(currentAvg)}
        </div>
        <div className="mt-1 font-display text-tag font-medium uppercase tracking-header text-muted">
          Avg Daily Active
        </div>
        <div className="mt-2 flex items-center justify-center gap-1.5">
          <span
            className={cn(
              "font-mono text-cell font-medium tabular-nums",
              deltaPositive ? "text-success" : "text-error",
            )}
          >
            {deltaPositive ? "+" : ""}
            {delta.toFixed(1)}%
          </span>
          <span className="font-display text-tag uppercase tracking-header text-muted">
            vs prior {period}
          </span>
        </div>
      </div>

      {/* Sparkline */}
      <div className="px-3 pb-3">
        <PreviewAreaChart
          data={chartData}
          height={120}
          showYAxis={false}
          showGrid={false}
        />
      </div>
    </Card>
  );
}

export default ActiveAccountsCard;
