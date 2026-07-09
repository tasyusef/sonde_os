import type { ReactNode } from "react";

/**
 * Single self-contained card for the collection detail page's right
 * column. Outer card has an "Insights" header at the top; child
 * widgets (Top Holders today, Floor / Sales / Listings / Trend
 * charts in follow-up phases) sit inside as their own nested cards
 * — each with its own border + rounded corners — with vertical gap
 * between them.
 *
 * Nested-card-in-card was Tim's call: each visualization reads as
 * its own framed widget rather than blending into a long
 * divide-y-separated list. Keeps the visual hierarchy clear when
 * five different charts share the same sidebar.
 */
export default function CollectionSidebar({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Insights
        </span>
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </div>
  );
}
