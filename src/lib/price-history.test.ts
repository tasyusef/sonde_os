import { describe, expect, it } from "vitest";
import {
  type Candle,
  formatAxisTime,
  formatCandleTime,
  formatChange,
  formatPrice,
  parseBitstamp,
  parseKraken,
  spanLabel,
  timeTicks,
  withinRange,
} from "./price-history";

const T = 1_793_354_400; // 2026-10-30 10:00 UTC

describe("parseBitstamp", () => {
  it("reads string candles, sorted by time", () => {
    const json = {
      data: {
        pair: "XRP/USD",
        ohlc: [
          { timestamp: `${T + 900}`, open: "1.24624", high: "1.24888", low: "1.24238", close: "1.24682" },
          { timestamp: `${T}`, open: "1.25133", high: "1.25171", low: "1.24615", close: "1.24615" },
        ],
      },
    };
    expect(parseBitstamp(json)).toEqual([
      { t: T, o: 1.25133, h: 1.25171, l: 1.24615, c: 1.24615 },
      { t: T + 900, o: 1.24624, h: 1.24888, l: 1.24238, c: 1.24682 },
    ]);
  });

  it("drops broken rows and duplicate times", () => {
    const row = { timestamp: `${T}`, open: "1", high: "2", low: "0.5", close: "1.5" };
    const json = {
      data: {
        ohlc: [
          row,
          { ...row, close: "1.6" },
          { ...row, timestamp: `${T + 1}`, high: "0.1" },
          { ...row, timestamp: `${T + 2}`, open: "abc" },
          null,
        ],
      },
    };
    expect(parseBitstamp(json)).toEqual([{ t: T, o: 1, h: 2, l: 0.5, c: 1.6 }]);
  });

  it("throws on another shape", () => {
    expect(() => parseBitstamp({ code: "404" })).toThrow();
    expect(() => parseBitstamp(null)).toThrow();
  });
});

describe("parseKraken", () => {
  it("reads the pair's rows and skips `last`", () => {
    const json = {
      error: [],
      result: {
        XXRPZUSD: [[T, "1.30531", "1.30621", "1.30443", "1.30549", "1.30539", "47969.1", 150]],
        last: T,
      },
    };
    expect(parseKraken(json)).toEqual([{ t: T, o: 1.30531, h: 1.30621, l: 1.30443, c: 1.30549 }]);
  });

  it("throws on an error or another shape", () => {
    expect(() => parseKraken({ error: ["EQuery:Unknown asset pair"] })).toThrow("Unknown asset pair");
    expect(() => parseKraken({ error: [], result: { last: T } })).toThrow();
  });
});

describe("withinRange", () => {
  const candles: Candle[] = [0, 1, 2, 3].map((d) => ({ t: T + d * 86_400, o: 1, h: 1, l: 1, c: 1 }));

  it("counts back from the newest candle", () => {
    expect(withinRange(candles, "1D").map((c) => c.t)).toEqual([T + 3 * 86_400]);
  });

  it("keeps everything for All", () => {
    expect(withinRange(candles, "ALL")).toBe(candles);
  });
});

describe("formatCandleTime", () => {
  it("shows the time on intraday ranges only", () => {
    expect(formatCandleTime(T, "1D")).toBe("2026-10-30 10:00 UTC");
    expect(formatCandleTime(T, "1Y")).toBe("2026-10-30");
  });
});

describe("formatAxisTime", () => {
  it("labels each range at its own scale", () => {
    expect(formatAxisTime(T, "1D")).toBe("10:00");
    expect(formatAxisTime(T, "7D")).toBe("Oct 30");
    expect(formatAxisTime(T, "1Y")).toBe("Oct 2026");
    expect(formatAxisTime(T, "ALL")).toBe("2026");
  });
});

describe("labels", () => {
  it("names each range's span", () => {
    expect(spanLabel("1D", T)).toBe("Past 24 hours");
    expect(spanLabel("ALL", 1_481_846_400)).toBe("Since 2016");
  });

  it("writes prices and signed changes", () => {
    expect(formatPrice(1.25123)).toBe("$1.2512");
    expect(formatChange(2.314)).toBe("+2.31%");
    expect(formatChange(-0.4)).toBe("-0.40%");
    expect(formatChange(18611.344)).toBe("+18,611.34%");
  });
});

describe("timeTicks", () => {
  const hour = 3600;
  const midnight = 1_793_318_400; // 2026-10-30 00:00 UTC

  it("labels whole hours at a stride that fits", () => {
    // Five-minute candles from 21:10 to 09:05.
    const times = Array.from({ length: 144 }, (_, i) => midnight - 2 * hour - 50 * 60 + i * 300);
    const ticks = timeTicks(times, "1D", 4);
    expect(ticks.map((k) => formatAxisTime(k.t, "1D"))).toEqual(["00:00", "03:00", "06:00", "09:00"]);
    for (const { i, t } of ticks) {
      expect(times[i]).toBeGreaterThanOrEqual(t);
      expect(times[i - 1]).toBeLessThan(t);
    }
  });

  it("labels new years for All", () => {
    const year = 365.25 * 86_400;
    const times = Array.from({ length: 100 }, (_, i) => 1_481_846_400 + (i * 9.8 * year) / 99);
    expect(timeTicks(times, "ALL", 5).map((k) => formatAxisTime(k.t, "ALL"))).toEqual([
      "2018",
      "2020",
      "2022",
      "2024",
      "2026",
    ]);
  });
});
