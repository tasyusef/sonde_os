import { type KeyboardEvent, type PointerEvent, useId, useMemo, useRef, useState } from "react";
import PixelCanvas, { type Palette } from "@/components/price/PixelCanvas";
import PriceReadout from "@/components/price/PriceReadout";
import { CELL, candleAtColumn, candleColumn, type ChartMode, chartLayout, rasterize } from "@/lib/pixel-chart";
import {
  type Candle,
  formatAxisTime,
  formatCandleTime,
  formatChange,
  formatPrice,
  type PriceRange,
  spanLabel,
  timeTicks,
} from "@/lib/price-history";
import { useCellGrid } from "./useCellGrid";

/** Colour tokens in `INK` order: grid, fill, line, up, down, cursor, marker. */
const PALETTE: Palette = [
  "",
  "--color-line",
  "--color-border",
  "--color-primary",
  "--color-success-mark",
  "--color-error-mark",
  "--color-muted",
  "--color-brand",
];

/** A `text-tag` label's line height, and the advance of one Departure
 *  Mono glyph at that size (px). */
const TAG_LINE = 16;
const TAG_GLYPH = 7;

/**
 * The chart itself: the bitmap, its price and time labels, and a cursor
 * that snaps to the nearest candle under the pointer or steps with the
 * arrow keys. Sized in whole cells to whatever box it gets: its floor,
 * or more when a filling parent (`PriceChart`) gives it the height.
 */
export default function PricePlot({ candles, mode, range }: { candles: Candle[]; mode: ChartMode; range: PriceRange }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const { cols, rows } = useCellGrid(plotRef);
  const summaryId = useId();
  const view = useMemo(
    () => (cols > 0 && rows > 0 ? chartLayout(candles, mode, cols, rows) : null),
    [candles, mode, cols, rows],
  );
  // A cursor belongs to one layout: a new range, style, width or refresh drops it.
  const [cursor, setCursor] = useState<{ view: typeof view; i: number } | null>(null);
  const active = view && cursor?.view === view ? cursor.i : null;
  const shown = view && active != null ? view.candles[active] : null;
  const cells = useMemo(
    () =>
      view &&
      rasterize({ cols, rows, mode, candles: view.candles, domain: view.domain, gridRows: view.ticks.map((t) => t.row), cursor: active }),
    [view, cols, rows, mode, active],
  );

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    if (!view) return;
    const x = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / CELL);
    setCursor({ view, i: candleAtColumn(x, view.candles.length, cols, mode) });
  };

  const step = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!view) return;
    if (e.key === "Escape") return setCursor(null);
    const last = view.candles.length - 1;
    const page = Math.max(1, Math.round(last / 10));
    const from = active ?? last + 1;
    const to = { ArrowLeft: from - 1, ArrowRight: active == null ? last : from + 1, PageUp: from - page, PageDown: from + page, Home: 0, End: last }[e.key];
    if (to == null) return;
    e.preventDefault();
    setCursor({ view, i: Math.min(last, Math.max(0, to)) });
  };

  const n = view?.candles.length ?? 0;
  // Round times, each left-aligned on its candle; one that would run
  // past the plot's right edge is dropped.
  const marks = view
    ? timeTicks(view.candles.map((c) => c.t), range, cols < 200 ? 3 : 6)
        .map(({ i, t }) => ({ label: formatAxisTime(t, range), x: candleColumn(i, n, cols, mode) * CELL }))
        .filter(({ label, x }) => x + label.length * TAG_GLYPH <= cols * CELL)
    : [];
  const last = candles[candles.length - 1];
  const change = ((last.c - candles[0].o) / candles[0].o) * 100;

  return (
    <div className="flex flex-1 flex-col">
      <PriceReadout candles={candles} shown={shown} range={range} />
      <div
        ref={plotRef}
        // A slider over the candles: the arrow keys, Home/End and Page
        // keys are its own, and screen readers read out each candle.
        tabIndex={0}
        role="slider"
        aria-label="XRP price chart"
        aria-describedby={summaryId}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, n - 1)}
        aria-valuenow={active ?? Math.max(0, n - 1)}
        aria-valuetext={describe(shown ?? view?.candles[n - 1] ?? last, range)}
        className="relative min-h-52 flex-1 cursor-crosshair touch-pan-y sm:min-h-72 lg:min-h-52"
        onPointerDown={pick}
        onPointerMove={pick}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setCursor(null);
        }}
        onKeyDown={step}
        onBlur={() => setCursor(null)}
      >
        {cells && <PixelCanvas cells={cells} cols={cols} rows={rows} palette={PALETTE} />}
        {/* Prices sit inside the plot, flush left on the line above their
             gridline, so the plot runs the column's full width. Left, so
             they never cover the latest candle; the chip keeps them
             legible over the fill. One without a line's height clear of
             the top is dropped. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {view?.ticks
            .filter(({ row }) => row * CELL >= TAG_LINE)
            .map(({ value, row }) => (
              <span
                key={value}
                className="absolute left-0 -translate-y-full bg-black pr-1 font-mono text-tag tabular-nums text-muted"
                style={{ top: row * CELL }}
              >
                {value.toFixed(view.decimals)}
              </span>
            ))}
        </div>
      </div>
      <div aria-hidden="true" className="relative mt-1 h-4">
        {marks.map(({ label, x }) => (
          <span
            key={x}
            className="absolute top-0 whitespace-nowrap font-mono text-tag tabular-nums text-muted"
            style={{ left: x }}
          >
            {label}
          </span>
        ))}
      </div>
      <p id={summaryId} className="sr-only">
        {`XRP/USD, ${spanLabel(range, candles[0].t).toLowerCase()}: ${formatPrice(last.c)} now, ${formatChange(change)}, `}
        {`low ${formatPrice(Math.min(...candles.map((c) => c.l)))}, high ${formatPrice(Math.max(...candles.map((c) => c.h)))}. `}
        Arrow keys step through the candles.
      </p>
    </div>
  );
}

function describe(c: Candle, range: PriceRange): string {
  return `${formatCandleTime(c.t, range)}: close ${formatPrice(c.c)}, open ${formatPrice(c.o)}, high ${formatPrice(c.h)}, low ${formatPrice(c.l)}`;
}
