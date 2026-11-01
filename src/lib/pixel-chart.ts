/**
 * The price chart's raster, worked out in whole cells. The chart draws
 * at cell resolution (one canvas pixel per cell) and the browser scales
 * it up with `image-rendering: pixelated`, so every mark is a square on
 * the same grid as the rest of Sonde: a 1-cell line, a dither fill
 * whose cells are on or off (never cut), candles with 1-cell wicks.
 *
 * Everything here is pure: `rasterize` returns a palette index per
 * cell and the component paints it.
 */

import type { Candle } from "./price-history";

/** CSS pixels per cell: the dither's grain. */
export const CELL = 2;
/** The narrowest candle body, in cells, and the gap after it. */
const MIN_BODY = 3;
const MIN_SLOT = MIN_BODY + 1;

/** Palette indices `rasterize` writes; 0 is empty. */
export const INK = { grid: 1, fill: 2, line: 3, up: 4, down: 5, cursor: 6, marker: 7 } as const;

/**
 * Merges runs of neighbouring candles so at most `max` remain: the
 * first open, the last close, the extremes between. Runs are counted
 * back from the newest, so the latest candle is never split.
 */
export function bucketCandles(candles: Candle[], max: number): Candle[] {
  const size = Math.ceil(candles.length / Math.max(1, max));
  if (size <= 1) return candles;
  const out: Candle[] = [];
  for (let end = candles.length; end > 0; end -= size) {
    const run = candles.slice(Math.max(0, end - size), end);
    out.push({
      t: run[0].t,
      o: run[0].o,
      h: Math.max(...run.map((c) => c.h)),
      l: Math.min(...run.map((c) => c.l)),
      c: run[run.length - 1].c,
    });
  }
  return out.reverse();
}

/** Round steps (1, 2, 2.5, 5 × 10ⁿ) inside [lo, hi], about `count` of them. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo) || count < 1) return [];
  const rough = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough * (1 - 1e-9)) ?? 10 * power;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}

/** The fewest decimals (at least two) that write every tick exactly. */
export function tickDecimals(ticks: number[]): number {
  let decimals = 2;
  for (const v of ticks) {
    while (decimals < 8 && Math.abs(Number(v.toFixed(decimals)) - v) > Math.abs(v) * 1e-9) decimals++;
  }
  return decimals;
}

/** The price span to draw: the data, with a little air above and below. */
export function priceDomain(values: number[]): [number, number] {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    lo *= 0.99;
    hi *= 1.01;
  }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

/** A price's row: 0 at the top, `rows - 1` at the bottom. */
export function rowOf(value: number, [lo, hi]: [number, number], rows: number): number {
  const r = Math.round(((hi - value) / (hi - lo)) * (rows - 1));
  return Math.min(rows - 1, Math.max(0, r));
}

/** Which column each point sits on when `count` points span `cols`. */
export function pointColumn(i: number, count: number, cols: number): number {
  return count < 2 ? cols - 1 : Math.round((i * (cols - 1)) / (count - 1));
}

/** The point nearest a column (the inverse of `pointColumn`). */
export function pointAtColumn(x: number, count: number, cols: number): number {
  if (count < 2) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((x * (count - 1)) / (cols - 1))));
}

/** One row per column, straight between the points. */
export function lineRows(rows: number[], count: number, cols: number): number[] {
  const out = new Array<number>(cols);
  for (let i = 0; i < count - 1; i++) {
    const x0 = pointColumn(i, count, cols);
    const x1 = pointColumn(i + 1, count, cols);
    for (let x = x0; x <= x1; x++) {
      out[x] = Math.round(rows[i] + ((rows[i + 1] - rows[i]) * (x - x0)) / Math.max(1, x1 - x0));
    }
  }
  if (count === 1) out.fill(rows[0]);
  return out;
}

/**
 * Each column's run [top, bottom] for a 1-cell line through `ys`: a
 * column reaches halfway to each neighbour's row, so steep moves stay
 * joined corner to corner and the line never gaps.
 */
export function lineRuns(ys: number[]): [number, number][] {
  return ys.map((y, x) => {
    let top = y;
    let bottom = y;
    const reach = (to: number) => {
      top = Math.min(top, to);
      bottom = Math.max(bottom, to);
    };
    if (x > 0) {
      const d = y - ys[x - 1];
      reach(ys[x - 1] + Math.trunc(d / 2) + Math.sign(d));
    }
    if (x < ys.length - 1) reach(y + Math.trunc((ys[x + 1] - y) / 2));
    return [top, bottom];
  });
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Whether a fill cell is on: an ordered dither of `density` (0–1), fixed
 *  to the grid, so neighbouring columns never shear the pattern. */
export function ditherOn(x: number, y: number, density: number): boolean {
  return density > BAYER[(y % 4) * 4 + (x % 4)];
}

/** The most candles that fit `cols` at the narrowest body. */
export function maxCandles(cols: number): number {
  return Math.max(1, Math.floor(cols / MIN_SLOT));
}

/**
 * Candles spread evenly over `cols`: each gets `slot` columns (not a
 * whole number, so the row fills the width) and a body of odd width,
 * so the wick sits on its middle column.
 */
export function candleSlots(count: number, cols: number) {
  const slot = cols / Math.max(1, count);
  let body = Math.max(MIN_BODY, Math.floor(slot) - Math.max(1, Math.floor(slot / 4)));
  if (body % 2 === 0) body -= 1;
  const left = (i: number) => Math.floor(i * slot + (slot - body) / 2);
  return { slot, body, left };
}

export type ChartMode = "line" | "candles";

export interface RasterSpec {
  cols: number;
  rows: number;
  mode: ChartMode;
  /** Already bucketed to fit: at most `cols` (line) or `maxCandles(cols)`. */
  candles: Candle[];
  domain: [number, number];
  /** Rows to rule as grid lines. */
  gridRows: number[];
  /** The hovered candle, or null. */
  cursor: number | null;
}

/** The chart as one palette index per cell, row by row. */
export function rasterize({ cols, rows, mode, candles, domain, gridRows, cursor }: RasterSpec): Uint8Array {
  const cells = new Uint8Array(cols * rows);
  const set = (x: number, y: number, ink: number) => {
    if (x >= 0 && x < cols && y >= 0 && y < rows) cells[y * cols + x] = ink;
  };
  // Dotted rules, every other cell.
  for (const y of gridRows) for (let x = 0; x < cols; x += 2) set(x, y, INK.grid);

  let cursorX: number | null = null;
  let marker: [number, number] | null = null;
  if (mode === "line") {
    const ys = lineRows(candles.map((c) => rowOf(c.c, domain, rows)), candles.length, cols);
    lineRuns(ys).forEach(([top, bottom], x) => {
      for (let y = bottom + 1; y < rows; y++) {
        // Half the cells just under the line, thinning to none at the floor.
        if (ditherOn(x, y, 0.5 * (1 - (y - bottom) / (rows - bottom)))) set(x, y, INK.fill);
      }
      for (let y = top; y <= bottom; y++) set(x, y, INK.line);
    });
    if (cursor != null) {
      cursorX = pointColumn(cursor, candles.length, cols);
      marker = [cursorX, ys[cursorX]];
    }
  } else {
    const slots = candleSlots(candles.length, cols);
    const { body } = slots;
    candles.forEach((c, i) => {
      const left = slots.left(i);
      const wick = left + (body - 1) / 2;
      const ink = c.c >= c.o ? INK.up : INK.down;
      for (let y = rowOf(c.h, domain, rows); y <= rowOf(c.l, domain, rows); y++) set(wick, y, ink);
      const top = rowOf(Math.max(c.o, c.c), domain, rows);
      const bottom = rowOf(Math.min(c.o, c.c), domain, rows);
      for (let y = top; y <= bottom; y++) for (let x = left; x < left + body; x++) set(x, y, ink);
      if (i === cursor) cursorX = wick;
    });
  }

  if (cursorX != null) {
    // A dotted rule through the hovered candle, under nothing it crosses.
    for (let y = 0; y < rows; y += 2) if (!cells[y * cols + cursorX]) set(cursorX, y, INK.cursor);
  }
  if (marker) {
    // A 3×3 block on the hovered point.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(marker[0] + dx, marker[1] + dy, INK.marker);
  }
  return cells;
}

/** The column a candle's point or wick sits on, for the time axis. */
export function candleColumn(i: number, count: number, cols: number, mode: ChartMode): number {
  if (mode === "line") return pointColumn(i, count, cols);
  const { left, body } = candleSlots(count, cols);
  return left(i) + (body - 1) / 2;
}

/** The candle under column `x`, for hover and touch. */
export function candleAtColumn(x: number, count: number, cols: number, mode: ChartMode): number {
  if (mode === "line") return pointAtColumn(x, count, cols);
  return Math.min(count - 1, Math.max(0, Math.floor(x / candleSlots(count, cols).slot)));
}

/** Everything the chart needs at one size: the candles merged to fit,
 *  the price span, and its ticks with the rows they rule. */
export function chartLayout(candles: Candle[], mode: ChartMode, cols: number, rows: number) {
  const shown = bucketCandles(candles, mode === "line" ? cols : maxCandles(cols));
  const domain = priceDomain(mode === "line" ? shown.map((c) => c.c) : shown.flatMap((c) => [c.h, c.l]));
  const ticks = niceTicks(domain[0], domain[1], Math.max(2, Math.round(rows / 40)));
  return {
    candles: shown,
    domain,
    ticks: ticks.map((value) => ({ value, row: rowOf(value, domain, rows) })),
    decimals: tickDecimals(ticks),
  };
}
