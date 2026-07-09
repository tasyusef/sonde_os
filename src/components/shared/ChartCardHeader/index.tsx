/**
 * ChartCardHeader — shared header strip for the chart cards on the
 * Network Analytics tab (TxVolume, FeeBurn, ActiveWallets, AMMFeeRevenue,
 * XRPSupply, DexVolume, TokenVelocity, etc.).
 *
 * Why this exists: every analytics chart card was independently
 * implementing the same JSX (title + stat line + period toggle) with
 * the `flex-col items-start gap-3 ... sm:flex-row sm:justify-between`
 * pattern. On mobile that pattern produced 4–5 row headers when the
 * stat line wrapped — title (1 line) + value + secondary stats
 * wrapping to 2–3 lines + toggle (1 line). The "VERY tall" headers
 * Tim flagged.
 *
 * Layout:
 * - Title + headline value stacked in one block on the left, tightly
 *   packed (mt-0.5 between title and value — Tim's call: "reduce
 *   the leading between the header and the headline value" so the
 *   pair reads as a single unit).
 * - Controls right-aligned via `ml-auto`, vertically centered against
 *   the full title+subtitle block via `items-center` on the outer
 *   flex (Tim's call again: "have the toggles centered inside the
 *   header"). Mirrors the pre-refactor `sm:items-center` behavior.
 * - On narrow viewports where title+toggle don't fit, toggle wraps
 *   to its own row — still right-aligned because `ml-auto` consumes
 *   remaining space on the wrapped line.
 *
 * Caller is responsible for wrapping any secondary/optional stats in
 * `hidden sm:inline` so they vanish on mobile rather than wrapping
 * the row. Net mobile worst case: 3 rows (title / value / toggle)
 * down from the original 4–5.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ChartCardHeaderProps {
  /** Brand-colored uppercase label. */
  title: string;
  /**
   * Stat row content. Caller composes — e.g. a primary value span
   * plus optional `<span className="hidden ... sm:inline">` for any
   * secondary stats that should disappear on mobile.
   */
  subtitle?: ReactNode;
  /**
   * Right-aligned controls (Toggle, ResponsiveSelect, etc.). For
   * dual-toggle cards (AMMFeeRevenue) just pass both toggles inside
   * a fragment — the wrapper here is `flex-wrap` so they stay
   * together and wrap as a unit if the row is tight.
   */
  controls?: ReactNode;
  className?: string;
}

export default function ChartCardHeader({
  title,
  subtitle,
  controls,
  className,
}: ChartCardHeaderProps) {
  return (
    <div className={cn("border-b border-elevated px-4 py-card-header", className)}>
      {/* Single layout for all viewports:
          - Title block + controls in one flex row, vertically centered
            against each other (items-center centers the controls
            against the full title+subtitle block since the title
            block is one flex item).
          - Controls right-aligned via ml-auto.
          - flex-wrap on the OUTER container lets the controls drop to
            their own line when the title is too wide to share — but
            they stay right-aligned on that wrapped line because
            ml-auto consumes the free space on the left.
          - The INNER controls wrapper deliberately does NOT have
            flex-wrap. Keeping it as a non-wrapping flex row + shrink-0
            holds the toggles together as a tight cluster — the
            previous flex-wrap there was letting the toggles spread
            across the row at certain widths (the bug Tim saw on the
            AMMFeeRevenue dual-toggle header). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* `flex-1 min-w-0` on the title block sets its flex-basis to 0,
             which keeps the outer flex-wrap from kicking in just because
             the title's intrinsic content width is wide. Without this,
             a long title like "AMM FEE REVENUE (EST.)" pushed the
             controls onto their own wrapped line (Tim's "looks
             ridiculous" call — toggles ended up below the headline
             instead of vertically centered with it). With it, the title
             shrinks to share the row, wrapping text within its block if
             needed, while the controls stay anchored on the right. */}
        <div className="min-w-0 flex-1">
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            {title}
          </span>
          {subtitle && (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              {subtitle}
            </div>
          )}
        </div>
        {controls && (
          <div className="flex shrink-0 items-center gap-2">
            {controls}
          </div>
        )}
      </div>
    </div>
  );
}

export { ChartCardHeader };
