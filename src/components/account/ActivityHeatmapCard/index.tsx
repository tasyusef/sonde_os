"use client";

import CollapsibleCard from "@/components/shared/CollapsibleCard";
import type { ActivityBucket } from "@/lib/clickhouse-queries";

/**
 * Free-tier activity heatmap. Calendar-grid view of the last 30 days,
 * cells colored by hourly tx count. Bucketing is hourly via
 * `getAccountActivityHeatmap`; we collapse to per-day for the visual
 * (sum across 24 hours) since hour-level granularity in a 30×24 grid
 * is too dense for the typical sidebar real estate.
 *
 * Sender-side activity only at this tier — the ingester's PK on
 * `transactions` is account-keyed for sender, so this lookup is
 * partition-pruned. Receiver + AffectedNodes coverage will fold in once
 * `account_tx_index` lands in slice 5.
 *
 * Visual: 5 states (empty + 4 positive intensity buckets) driven by
 * per-day count. Intensity scales relative to a clamped max (≥
 * `INTENSITY_FLOOR`) so an account with one lonely tx in the window
 * doesn't flood that day to full-saturation brand. Sparse accounts read
 * as faintly colored, dense accounts saturate.
 *
 * Accessibility: the grid is decorative — the meaningful summary
 * (total txs, active days, date range) lives in the heading band
 * inside the card body. Cells are `aria-hidden`; the `role="img"`
 * grid wrapper carries the visual semantics.
 *
 * Renders null when there's no activity in the window.
 */
const INTENSITY_FLOOR = 5;
interface Props {
  /** Sender-side hourly buckets, oldest-first per `getAccountActivityHeatmap`. */
  buckets: ActivityBucket[];
  /** Day window the helper queried. Defaults to 30. */
  days?: number;
}

const XRPL_EPOCH_OFFSET_MS = 946_684_800_000;

export default function ActivityHeatmapCard({ buckets, days = 30 }: Props) {
  if (buckets.length === 0) return null;

  // Collapse hourly buckets into per-day counts. Build a Map keyed on
  // YYYY-MM-DD so day comparisons don't depend on Date object identity.
  const byDay = new Map<string, number>();
  for (const b of buckets) {
    const ms = b.hour * 1000 + XRPL_EPOCH_OFFSET_MS;
    const d = new Date(ms);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + b.count);
  }

  // Walk N days backward from today (UTC) to fill the grid in
  // oldest→newest order, including empty days.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cells: Array<{ key: string; count: number; date: Date }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    cells.push({ key, count: byDay.get(key) ?? 0, date: d });
  }

  const observedMax = Math.max(...cells.map((c) => c.count), 1);
  // Clamp the intensity-scale denominator so sparse accounts don't show a
  // single lone tx as a max-saturation cell. Floor of 5 means the "hot"
  // bucket only kicks in when a day genuinely had ≥4 txs.
  const intensityMax = Math.max(observedMax, INTENSITY_FLOOR);
  const totalTxs = cells.reduce((acc, c) => acc + c.count, 0);
  const activeDays = cells.filter((c) => c.count > 0).length;
  // Year-boundary disambiguation. When the 30-day window straddles a
  // year (rare — only late Dec / early Jan), include the year on both
  // endpoints so "12-06 → 01-04" doesn't read as 11 months ago.
  const showYear =
    cells[0]?.key.slice(0, 4) !== cells[cells.length - 1]?.key.slice(0, 4);
  const startLabel = showYear ? cells[0]?.key : cells[0]?.key.slice(5);
  const endLabel = showYear
    ? cells[cells.length - 1]?.key
    : cells[cells.length - 1]?.key.slice(5);

  return (
    <CollapsibleCard
      title="Activity"
      storageKey="activity"
      // Total tx count surfaces in the header next to the title — same
      // pattern as "Transaction History 12" elsewhere. Active days +
      // window length get their own row inside the body.
      count={totalTxs}
    >
      <div
        aria-label={`Activity over the last ${days} days: ${totalTxs.toLocaleString()} transactions on ${activeDays} active day${activeDays === 1 ? "" : "s"}, peak ${observedMax.toLocaleString()} per day`}
        className="px-4 py-3"
      >
        <p className="mb-3 font-mono text-tag text-muted">
          Last {days} days · {activeDays} active day
          {activeDays === 1 ? "" : "s"} · sender side
        </p>
        {/* Decorative grid — `role="img"` signals this is a single
            visual, not a navigable widget. Cells are `aria-hidden`.
            Hover titles preserved for sighted users who want exact
            per-day counts. */}
        <div
          role="img"
          // 15 cols below `lg:` matches the breakpoint where the account
          // page collapses from two-column to single-column — at sm:
          // (640px) the card is still in a wider layout zone, so 30
          // tiny cells would shrink under the 24px touch-target floor.
          className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1 lg:grid-cols-[repeat(30,minmax(0,1fr))]"
        >
          {cells.map((c) => {
            const ratio = c.count / intensityMax;
            const intensity =
              c.count === 0
                ? 0
                : ratio > 0.75
                  ? 4
                  : ratio > 0.5
                    ? 3
                    : ratio > 0.25
                      ? 2
                      : 1;
            const bg =
              intensity === 0
                ? "bg-elevated"
                : intensity === 1
                  ? "bg-brand/20"
                  : intensity === 2
                    ? "bg-brand/40"
                    : intensity === 3
                      ? "bg-brand/60"
                      : "bg-brand";
            return (
              <div
                key={c.key}
                aria-hidden="true"
                title={`${c.key} — ${c.count} txs`}
                className={`aspect-square rounded-swatch ${bg}`}
              />
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 font-display text-tag uppercase tracking-header text-muted">
          <span>{startLabel}</span>
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span>Less</span>
            <span className="block size-2 rounded-swatch bg-elevated" />
            <span className="block size-2 rounded-swatch bg-brand/20" />
            <span className="block size-2 rounded-swatch bg-brand/40" />
            <span className="block size-2 rounded-swatch bg-brand/60" />
            <span className="block size-2 rounded-swatch bg-brand" />
            <span>More</span>
          </div>
          <span>{endLabel}</span>
        </div>
      </div>
    </CollapsibleCard>
  );
}
