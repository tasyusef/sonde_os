/* ————————————————————————————————————————————
   Reusable preview primitives shared by:
   - Landing page mock UI cards (FeaturePreview)
   - Marketing tweet cards (src/components/marketing/cards)

   Tiny self-contained building blocks using Sonde design tokens.
   No data fetching, no state — purely compositional.
   ———————————————————————————————————————————— */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export { default as PreviewAreaChart } from "./PreviewAreaChart";

/* ——— Card wrapper ——— */
export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-surface shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ——— Label/value row used in card bodies ——— */
export function Row({
  label,
  value,
  mono = true,
  valueColor,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5 last:border-b-0">
      <span className="font-display text-tag font-medium uppercase tracking-header text-muted">
        {label}
      </span>
      <span
        className={cn(
          mono ? "font-mono text-cell" : "font-body text-ui",
          valueColor ?? "text-primary",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ——— Colored tag (transaction type, severity, etc.) ——— */
export function TypeTag({
  label,
  color,
}: {
  label: string;
  color: string;
}) {
  return (
    <span
      className="inline-flex rounded-tag px-2 py-0.5 font-mono text-tag font-medium"
      style={{
        backgroundColor: `${color}1A`,
        color,
      }}
    >
      {label}
    </span>
  );
}


