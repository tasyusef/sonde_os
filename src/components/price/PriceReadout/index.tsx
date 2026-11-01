import {
  type Candle,
  formatCandleTime,
  formatChange,
  formatPrice,
  type PriceRange,
  spanLabel,
} from "@/lib/price-history";
import { cn } from "@/lib/utils";

/**
 * The numbers above the chart: the latest price and its change over the
 * range, or, while a candle is picked, that candle's close, time and
 * open/high/low. The change always counts from the range's first open,
 * so moving the cursor reads as "how far from the start".
 */
export default function PriceReadout({
  candles,
  shown,
  range,
}: {
  candles: Candle[];
  shown: Candle | null;
  range: PriceRange;
}) {
  const first = candles[0];
  const close = (shown ?? candles[candles.length - 1]).c;
  const change = ((close - first.o) / first.o) * 100;
  const open = shown ? shown.o : first.o;
  const high = shown ? shown.h : Math.max(...candles.map((c) => c.h));
  const low = shown ? shown.l : Math.min(...candles.map((c) => c.l));

  return (
    <div className="mb-3 font-mono tabular-nums">
      <p className="flex items-baseline gap-3">
        <span className="text-value text-primary">{formatPrice(close)}</span>
        <span className={cn("text-cell", change >= 0 ? "text-success" : "text-error")}>
          {formatChange(change)}
        </span>
      </p>
      {/* Fixed widths, so the figures hold still as the cursor moves. */}
      <p className="flex flex-col text-tag text-muted sm:flex-row sm:gap-4">
        <span className="sm:w-40">{shown ? formatCandleTime(shown.t, range) : spanLabel(range, first.t)}</span>
        <span className="flex gap-3">
          <Figure label="O" value={open} />
          <Figure label="H" value={high} />
          <Figure label="L" value={low} />
        </span>
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <span>
      {label} <span className="text-primary">{value.toFixed(4)}</span>
    </span>
  );
}
