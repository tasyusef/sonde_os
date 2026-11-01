import { useState } from "react";
import PricePlot from "@/components/price/PricePlot";
import Button from "@/components/shared/Button";
import LoadingDots from "@/components/shared/LoadingDots";
import Section from "@/components/shared/Section";
import Skeleton from "@/components/shared/Skeleton";
import Toggle, { type ToggleOption } from "@/components/shared/Toggle";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import type { ChartMode } from "@/lib/pixel-chart";
import type { PriceRange } from "@/lib/price-history";
import { cn } from "@/lib/utils";

const MODES: ToggleOption<ChartMode>[] = [
  { value: "line", label: "Line" },
  { value: "candles", label: "Candles" },
];

const RANGE_OPTIONS: ToggleOption<PriceRange>[] = [
  { value: "1D", label: "1D" },
  { value: "7D", label: "7D" },
  { value: "1M", label: "1M" },
  { value: "1Y", label: "1Y" },
  { value: "ALL", label: "All" },
];

/**
 * XRP/USD over a chosen range, drawn as a pixel bitmap: a line with a
 * dithered fill, or candles. Candles come straight from Bitstamp (Kraken
 * if it fails) in the browser. A column: with `flex-1` in a parent that
 * has the height, the plot grows to fill it.
 */
export default function PriceChart({ className }: { className?: string }) {
  const [mode, setMode] = useState<ChartMode>("line");
  const [range, setRange] = useState<PriceRange>("1D");
  const { history, switching, failed, retry } = usePriceHistory(range);

  return (
    <Section
      title="XRP price"
      className={cn("flex flex-col", className)}
      note={history && !failed ? `XRP/USD on ${history.source}. Times in UTC.` : null}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Toggle options={MODES} active={mode} onChange={setMode} ariaLabel="Chart style" />
        <div className="flex items-center gap-3">
          {switching && <LoadingDots className="text-muted" />}
          <Toggle options={RANGE_OPTIONS} active={range} onChange={setRange} ariaLabel="Time range" />
        </div>
      </div>
      {failed ? (
        <div role="alert" className="flex min-h-72 flex-1 flex-col items-center justify-center gap-4 sm:min-h-96 lg:min-h-72">
          <p className="font-mono text-cell text-error">{"Couldn't load the price from Bitstamp or Kraken."}</p>
          <Button onClick={retry} variant="outline" size="md">
            Try again
          </Button>
        </div>
      ) : history ? (
        <PricePlot candles={history.candles} mode={mode} range={history.range} />
      ) : (
        <div role="status" aria-label="Loading the price chart" className="flex flex-1 flex-col">
          <Skeleton className="mb-3 h-12 w-48" />
          <Skeleton className="min-h-56 flex-1 sm:min-h-76 lg:min-h-56" />
        </div>
      )}
    </Section>
  );
}
