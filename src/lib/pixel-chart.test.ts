import { describe, expect, it } from "vitest";
import {
  bucketCandles,
  candleAtColumn,
  candleColumn,
  candleSlots,
  chartLayout,
  ditherOn,
  INK,
  lineRows,
  lineRuns,
  maxCandles,
  niceTicks,
  pointAtColumn,
  pointColumn,
  priceDomain,
  rasterize,
  rowOf,
  tickDecimals,
} from "./pixel-chart";
import type { Candle } from "./price-history";

const candle = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t, o, h, l, c });

describe("bucketCandles", () => {
  const five = [1, 2, 3, 4, 5].map((v, i) => candle(i, v, v + 1, v - 1, v + 0.5));

  it("leaves candles that fit alone", () => {
    expect(bucketCandles(five, 5)).toBe(five);
  });

  it("merges runs counted back from the newest", () => {
    expect(bucketCandles(five, 2)).toEqual([candle(0, 1, 3, 0, 2.5), candle(2, 3, 6, 2, 5.5)]);
  });
});

describe("niceTicks", () => {
  it("steps by round numbers inside the span", () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(1.21, 1.29, 4)).toEqual([1.22, 1.24, 1.26, 1.28]);
    expect(niceTicks(0.8, 1.3, 5)).toEqual([0.8, 0.9, 1, 1.1, 1.2, 1.3]);
  });

  it("returns nothing for an empty span", () => {
    expect(niceTicks(1, 1, 4)).toEqual([]);
  });
});

describe("tickDecimals", () => {
  it("writes every tick exactly, with at least two decimals", () => {
    expect(tickDecimals([1, 2])).toBe(2);
    expect(tickDecimals([1.22, 1.24])).toBe(2);
    expect(tickDecimals([0.0025, 0.005])).toBe(4);
  });
});

describe("priceDomain", () => {
  it("pads the data's span", () => {
    const [lo, hi] = priceDomain([1, 2]);
    expect(lo).toBeCloseTo(0.94);
    expect(hi).toBeCloseTo(2.06);
  });

  it("opens up a flat series", () => {
    const [lo, hi] = priceDomain([1, 1]);
    expect(lo).toBeLessThan(1);
    expect(hi).toBeGreaterThan(1);
  });
});

describe("rowOf", () => {
  it("puts the top of the domain on row 0 and clamps", () => {
    expect(rowOf(2, [1, 2], 11)).toBe(0);
    expect(rowOf(1, [1, 2], 11)).toBe(10);
    expect(rowOf(1.5, [1, 2], 11)).toBe(5);
    expect(rowOf(9, [1, 2], 11)).toBe(0);
    expect(rowOf(0, [1, 2], 11)).toBe(10);
  });
});

describe("point columns", () => {
  it("spans the first and last columns and round-trips", () => {
    expect(pointColumn(0, 3, 101)).toBe(0);
    expect(pointColumn(2, 3, 101)).toBe(100);
    for (let i = 0; i < 7; i++) expect(pointAtColumn(pointColumn(i, 7, 50), 7, 50)).toBe(i);
  });
});

describe("lineRows", () => {
  it("interpolates between the points", () => {
    expect(lineRows([0, 4], 2, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(lineRows([2, 2, 0], 3, 5)).toEqual([2, 2, 2, 1, 0]);
  });
});

describe("lineRuns", () => {
  it("keeps a flat line one cell thick", () => {
    expect(lineRuns([3, 3, 3])).toEqual([
      [3, 3],
      [3, 3],
      [3, 3],
    ]);
  });

  it("joins steep moves corner to corner without overlap", () => {
    const ys = [10, 0, 7, 7, 1, 20, 19, 0];
    const runs = lineRuns(ys);
    runs.forEach(([top, bottom], x) => {
      expect(top).toBeLessThanOrEqual(ys[x]);
      expect(bottom).toBeGreaterThanOrEqual(ys[x]);
      if (x === 0) return;
      const [pTop, pBottom] = runs[x - 1];
      // Touching rows or one row apart (a diagonal step), never a gap.
      const gap = Math.max(top - pBottom, pTop - bottom);
      expect(gap).toBeLessThanOrEqual(1);
    });
  });
});

describe("ditherOn", () => {
  const count = (density: number) => {
    let on = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (ditherOn(x, y, density)) on++;
    return on;
  };

  it("lights the share of cells its density asks for", () => {
    expect(count(0)).toBe(0);
    expect(count(0.25)).toBe(4);
    expect(count(0.5)).toBe(8);
    expect(count(1)).toBe(16);
  });

  it("is a checkerboard at half", () => {
    expect(ditherOn(0, 0, 0.5)).toBe(true);
    expect(ditherOn(1, 0, 0.5)).toBe(false);
    expect(ditherOn(1, 1, 0.5)).toBe(true);
  });
});

describe("candleSlots", () => {
  it("keeps bodies odd and at least three wide", () => {
    for (const [count, cols] of [
      [50, 200],
      [10, 200],
      [122, 600],
      [7, 30],
    ]) {
      const { body, slot } = candleSlots(count, cols);
      expect(body % 2).toBe(1);
      expect(body).toBeGreaterThanOrEqual(3);
      expect(body).toBeLessThan(slot + 1);
    }
  });

  it("spreads candles across the whole width", () => {
    const { left, body } = candleSlots(122, 600);
    expect(left(0)).toBeLessThan(4);
    expect(left(121) + body).toBeGreaterThan(596);
  });

  it("fits as many as the narrowest slot allows", () => {
    expect(maxCandles(200)).toBe(50);
    expect(maxCandles(2)).toBe(1);
  });
});

describe("candleAtColumn", () => {
  it("finds the slot under a column", () => {
    expect(candleAtColumn(0, 10, 100, "candles")).toBe(0);
    expect(candleAtColumn(55, 10, 100, "candles")).toBe(5);
    expect(candleAtColumn(99, 10, 100, "candles")).toBe(9);
  });
});

describe("rasterize", () => {
  const at = (cells: Uint8Array, cols: number, x: number, y: number) => cells[y * cols + x];

  it("draws a line with dither fill below it, never above", () => {
    const cols = 20;
    const rows = 20;
    const candles = [candle(0, 1, 1, 1, 1), candle(1, 1, 1, 1, 1)];
    const cells = rasterize({ cols, rows, mode: "line", candles, domain: [0, 2], gridRows: [], cursor: null });
    const y = rowOf(1, [0, 2], rows);
    for (let x = 0; x < cols; x++) {
      expect(at(cells, cols, x, y)).toBe(INK.line);
      for (let above = 0; above < y; above++) expect(at(cells, cols, x, above)).toBe(0);
    }
    expect([...cells].filter((v) => v === INK.fill).length).toBeGreaterThan(0);
  });

  it("colours candles by direction, with wicks to the extremes", () => {
    const cols = 8;
    const rows = 11;
    const candles = [candle(0, 4, 8, 2, 6), candle(1, 6, 7, 3, 4)];
    const cells = rasterize({ cols, rows, mode: "candles", candles, domain: [0, 10], gridRows: [], cursor: null });
    const { left, body } = candleSlots(2, cols);
    const wick = left(0) + (body - 1) / 2;
    expect(at(cells, cols, wick, rowOf(8, [0, 10], rows))).toBe(INK.up);
    expect(at(cells, cols, wick, rowOf(2, [0, 10], rows))).toBe(INK.up);
    expect(at(cells, cols, left(1), rowOf(5, [0, 10], rows))).toBe(INK.down);
  });

  it("rules grid rows and marks the cursor", () => {
    const cols = 10;
    const rows = 10;
    const candles = [candle(0, 1, 1, 1, 1), candle(1, 1, 1, 1, 1)];
    const cells = rasterize({ cols, rows, mode: "line", candles, domain: [0, 4], gridRows: [0], cursor: 1 });
    expect(at(cells, cols, 0, 0)).toBe(INK.grid);
    expect(at(cells, cols, 1, 0)).toBe(0);
    expect(at(cells, cols, cols - 1, rowOf(1, [0, 4], rows))).toBe(INK.marker);
  });
});

describe("chartLayout", () => {
  const candles = Array.from({ length: 300 }, (_, i) => candle(i, 1 + i / 1000, 1.4, 0.9, 1 + (i + 1) / 1000));

  it("fits the candles to the width and rules round ticks", () => {
    const line = chartLayout(candles, "line", 100, 120);
    expect(line.candles.length).toBeLessThanOrEqual(100);
    expect(line.ticks.length).toBeGreaterThanOrEqual(2);
    for (const { value, row } of line.ticks) {
      expect(value).toBeGreaterThanOrEqual(line.domain[0]);
      expect(row).toBe(rowOf(value, line.domain, 120));
    }
  });

  it("spans highs and lows for candles, closes for the line", () => {
    expect(chartLayout(candles, "candles", 100, 120).domain[1]).toBeGreaterThan(1.4);
    expect(chartLayout(candles, "line", 100, 120).domain[1]).toBeLessThan(1.4);
  });

  it("puts each candle's column on its point or wick", () => {
    expect(candleColumn(0, 10, 101, "line")).toBe(0);
    const { left, body } = candleSlots(10, 100);
    expect(candleColumn(3, 10, 100, "candles")).toBe(left(3) + (body - 1) / 2);
  });
});
