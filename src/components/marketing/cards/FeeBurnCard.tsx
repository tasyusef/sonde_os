"use client";

import { Card, Row, PreviewAreaChart } from "@/components/shared/PreviewPrimitives";

/* ————————————————————————————————————————————
   XRP fee burn tweet card.

   Tweet format: 7-day burn sparkline with period total and
   30-day cumulative burn. The deflationary supply narrative
   is evergreen engagement in the XRP community.
   ———————————————————————————————————————————— */

export interface FeeBurnCardProps {
  /** Hourly burn data for sparkline, ordered oldest → newest */
  timeSeries: { timestamp: number; value: number }[];
  /** Total XRP burned in the display period */
  periodBurnXrp: number;
  /** XRP burned in the last 30 days */
  last30dBurnXrp: number;
  /** Period label shown in header */
  period?: string;
}

// Deterministic demo data — same output on every call, on both server
// and client. Earlier versions used Math.random() + Date.now() at
// module init time, which produced different arrays during SSR vs
// hydration and tripped React's hydration warning. The card is a
// preview placeholder; production consumers always pass real props,
// so "looks plausible" matters more than "actually random."
function makeDemoSeries(): { timestamp: number; value: number }[] {
  const points: { timestamp: number; value: number }[] = [];
  const baseTs = 1_756_000_000_000; // fixed 2025-08-23 reference
  for (let i = 167; i >= 0; i--) {
    const ts = baseTs - i * 3_600_000;
    const wave = 18 + 12 * (Math.sin(i / 9.3) * 0.5 + 0.5);
    const spike = i % 19 === 0 ? 32 : 0;
    points.push({ timestamp: ts, value: Math.round((wave + spike) * 100) / 100 });
  }
  return points;
}

const DEFAULT_PROPS: FeeBurnCardProps = {
  timeSeries: makeDemoSeries(),
  periodBurnXrp: 3_842,
  last30dBurnXrp: 16_450,
  period: "7D",
};

function formatXrp(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export function FeeBurnCard(props: Partial<FeeBurnCardProps> = {}) {
  const { timeSeries, periodBurnXrp, last30dBurnXrp, period } = {
    ...DEFAULT_PROPS,
    ...props,
  };

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          XRP Fee Burn
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted">
          {period}
        </span>
      </div>

      {/* Hero number */}
      <div className="px-6 py-6 text-center">
        <div className="font-mono text-display-lg font-medium tabular-nums text-primary">
          {formatXrp(periodBurnXrp)}
        </div>
        <div className="mt-1 font-display text-tag font-medium uppercase tracking-header text-muted">
          XRP Burned
        </div>
      </div>

      {/* Sparkline */}
      <div className="px-3 pb-2">
        <PreviewAreaChart
          data={timeSeries}
          height={100}
          color="var(--color-warning)"
          showYAxis={false}
          showGrid={false}
        />
      </div>

      {/* Stat rows */}
      <Row label="30D Burn" value={`${formatXrp(last30dBurnXrp)} XRP`} />
    </Card>
  );
}

export default FeeBurnCard;
