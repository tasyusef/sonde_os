import { formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CollectionValuation } from "./types";

/**
 * Inline floor / total-XRP / total-USD cluster used by the collection
 * row (header + mobile drawer) and the single-collection view's
 * heading. Floor is omitted when there's no active bid floor (`0`).
 */
export default function ValuationLine({
  valuation,
  className,
}: {
  valuation: CollectionValuation;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-x-2 gap-y-0.5",
        className,
      )}
    >
      {valuation.floorPriceXrp > 0 && (
        <span className="whitespace-nowrap font-mono text-label text-muted">
          Floor:{" "}
          {valuation.floorPriceXrp.toLocaleString("en-US", {
            maximumFractionDigits: 2,
          })}{" "}
          XRP
        </span>
      )}
      <span className="whitespace-nowrap font-mono text-cell font-medium tabular-nums text-primary">
        {valuation.totalValueXrp.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        })}{" "}
        XRP
      </span>
      <span className="whitespace-nowrap font-mono text-label tabular-nums text-muted">
        {formatVolume(valuation.totalValueUsd)}
      </span>
    </div>
  );
}
