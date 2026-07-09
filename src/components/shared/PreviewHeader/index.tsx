import { type ReactNode } from "react";

export interface PreviewHeaderProps {
  /** Brand-colored uppercase mono label. */
  label: string;
  /** The main value (e.g. "24,817.42 XRP"). */
  primaryValue: ReactNode;
  /** Secondary inline value (e.g. "+12.4%"). */
  secondaryValue?: ReactNode;
  /** Optional tertiary label below (e.g. "Total: 1.24M XRP"). */
  tertiaryLabel?: ReactNode;
  /** Optional content on the right side (Toggle, badge, button, etc.). */
  rightSlot?: ReactNode;
}

/**
 * Reusable header for preview cards and dashboard sections.
 * Stacks vertically on mobile (flex-col), horizontal on sm+.
 *
 * Layout:
 *   [BRAND LABEL]              [rightSlot]
 *   [Primary Value] [Secondary]
 *   [Tertiary Label]
 *
 * Used by:
 * - Landing page feature previews (AccountPreview, NetworkPreview, etc.)
 * - Any chart card with brand label + stat + toggle header
 */
export default function PreviewHeader({
  label,
  primaryValue,
  secondaryValue,
  tertiaryLabel,
  rightSlot,
}: PreviewHeaderProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-elevated px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          {label}
        </span>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-mono text-value font-medium tabular-nums text-primary">
            {primaryValue}
          </span>
          {secondaryValue && (
            <span className="font-mono text-cell">{secondaryValue}</span>
          )}
          {tertiaryLabel && (
            <span className="font-mono text-cell text-muted">{tertiaryLabel}</span>
          )}
        </div>
      </div>
      {rightSlot && <div className="w-fit shrink-0">{rightSlot}</div>}
    </div>
  );
}
