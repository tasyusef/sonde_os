"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useLiveData } from "@/hooks/useLiveData";
import type { TxTypeDistribution } from "@/types/network";

interface CustomTooltipProps {
  active?: boolean;
  payload?: { payload: TxTypeDistribution }[];
}

function ChartTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-cell font-medium text-primary">{d.family}</p>
      <p className="font-mono text-tag text-muted">
        {d.count} txns ({d.percentage}%)
      </p>
    </div>
  );
}

function CardHeader({
  children,
}: {
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-success"
        />
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Live Transaction Types
        </span>
      </div>
      {children}
    </div>
  );
}

export default function TxTypeDistributionChart({
  initialDistribution,
}: {
  initialDistribution: TxTypeDistribution[];
}) {
  const live = useLiveData();

  const distribution = live.txDistribution ?? initialDistribution;
  const totalTxCount = distribution.reduce((sum, d) => sum + d.count, 0);
  const maxCount = Math.max(...distribution.map((d) => d.count), 1);

  if (distribution.length === 0) {
    return (
      <div className="flex h-full flex-col rounded-2xl shadow-card bg-surface">
        <CardHeader />
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-mono text-body text-muted">No transaction data</p>
        </div>
      </div>
    );
  }

  return (
    // h-full lets CSS Grid stretch this card to match the sibling
    // (TopTradingPairs) row height. The min-h floor matches what
    // TopTradingPairs naturally renders at (header + 10 pair rows ≈
    // 520px) so when it's still loading or short on data, this card
    // doesn't collapse smaller than design and create asymmetry.
    <div className="flex h-full flex-col rounded-2xl shadow-card bg-surface sm:min-h-[520px]">
      <CardHeader>
        <span className="font-mono text-label tabular-nums text-muted">
          Latest Ledger
        </span>
      </CardHeader>
      {/* sm+: items-stretch lets the legend column expand vertically to
          fill the card height. The donut stays vertically centered via
          my-auto on its wrapper. Without this stretch, items-center would
          float both children in the middle of a tall row, leaving a
          visible gap below. */}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 px-4 py-4 sm:flex-row sm:items-stretch sm:overflow-visible">
        {/* Donut chart — aspect-square keeps it round at any size. Mobile
            uses w-full + max-w; sm+ scales width with the card (45% of body
            width, capped at 320px). my-auto vertically centers it inside
            the stretched row so it doesn't get distorted into an oval. */}
        <div
          className="relative aspect-square w-full max-w-[260px] shrink-0 sm:my-auto sm:w-[min(45%,320px)] sm:max-w-none"
          role="img"
          aria-label={`Donut chart showing ${totalTxCount} transactions by type`}
        >
          {/* Center label — behind chart so tooltip renders on top */}
          <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center">
            <span className="font-mono text-display font-medium tabular-nums text-primary">
              {totalTxCount}
            </span>
            <span className="font-mono text-label text-muted">txns</span>
          </div>
          <div className="relative z-10 h-full w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distribution}
                  cx="50%"
                  cy="50%"
                  innerRadius="62%"
                  outerRadius="94%"
                  dataKey="count"
                  stroke="none"
                  // Live ledger data updates the distribution every few
                  // seconds. Recharts' default animation interpolates
                  // arcs between old and new state, and on sub-1% slivers
                  // (Trust Line / Account / Escrow at 0.5% = 1.8° each)
                  // the interpolation hits sub-pixel boundaries that show
                  // as momentary visible gaps. Static rendering is
                  // smoother for live data anyway.
                  isAnimationActive={false}
                >
                  {distribution.map((entry) => (
                    <Cell key={entry.family} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Legend with proportion bars. Mobile: full-width below the
            donut, items stack with fixed `space-y` gaps. sm+: fills the
            remaining row width and centers items vertically as a group
            (justify-center) so they sit aligned with the donut's
            my-auto vertical center. The previous `justify-around`
            spread rows across the full card height — which made
            spacing look awkward (Tim's call) when matched-height with
            TopTradingPairs left lots of vertical room. */}
        <div className="w-full flex-1 space-y-2.5 sm:w-auto sm:flex sm:flex-col sm:justify-center">
          {distribution.map((d) => (
            <div key={d.family} className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="font-mono text-cell font-medium text-primary">
                    {d.family}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-cell tabular-nums text-secondary">
                    {d.count}
                  </span>
                  <span className="w-[50px] text-right font-mono text-tag tabular-nums text-muted">
                    {d.percentage}%
                  </span>
                </div>
              </div>
              {/* Proportion bar */}
              <div className="h-1 overflow-hidden rounded-full bg-elevated">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${(d.count / maxCount) * 100}%`,
                    backgroundColor: d.color,
                    opacity: 0.6,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
