import type { ReactNode } from "react";
import Skeleton from "@/components/shared/Skeleton";

/** One of the token stage's figures (price, supply), the way the
 *  account stage shows its balance. No `value` yet is a skeleton. */
export default function TokenFigure({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: ReactNode | undefined;
  /** The ticker or XRP: data, so the data face. */
  unit?: string;
  note?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="font-display text-caps uppercase tracking-header text-muted">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-10 w-2/3" />
      ) : (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 font-mono tabular-nums">
          <span className="min-w-0 break-all text-figure text-primary">{value}</span>
          {unit && <span className="min-w-0 break-all text-value text-muted">{unit}</span>}
        </p>
      )}
      {note && <p className="mt-1 font-mono text-cell tabular-nums text-muted">{note}</p>}
    </div>
  );
}
