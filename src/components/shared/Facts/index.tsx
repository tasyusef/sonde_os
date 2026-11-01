import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Label/value rows: the label left, the value right, no rules. */
export default function Facts({ children }: { children: ReactNode }) {
  return <dl>{children}</dl>;
}

export function Fact({
  label,
  dataLabel,
  children,
}: {
  label: ReactNode;
  /** The label is ledger or third-party data (an NFT trait), so it
   *  keeps the data face instead of PARC caps. */
  dataLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <dt
        className={cn(
          "shrink-0 text-muted",
          dataLabel
            ? "min-w-0 break-words font-mono text-label uppercase"
            : "font-display text-caps uppercase tracking-header",
        )}
      >
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right font-mono text-cell text-primary">
        {children}
      </dd>
    </div>
  );
}

export { Facts };
