import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountAge,
  formatChartDateTick,
  formatCompactCount,
  formatCompactNumber,
  formatDropsAsXrp,
  formatInteger,
  formatScaled,
  formatVolume,
  formatXrp,
  formatXrpValue,
  parseDrops,
  splitDateTime,
  timeAgo,
} from "./format";

afterEach(() => {
  vi.useRealTimers();
});

describe("accountAge", () => {
  // 2026-10-30T00:00:00Z, and the XRPL-epoch time `days` before it.
  const now = Date.UTC(2026, 9, 30);
  const before = (days: number) => (now - days * 86_400_000) / 1000 - 946684800;

  it("counts days under a year", () => {
    expect(accountAge(before(0), now)).toBe("0 days");
    expect(accountAge(before(1), now)).toBe("1 day");
    expect(accountAge(before(364), now)).toBe("364 days");
  });

  it("counts whole years from a year on", () => {
    expect(accountAge(before(365), now)).toBe("1 year");
    expect(accountAge(before(729), now)).toBe("1 year");
    expect(accountAge(before(3243), now)).toBe("8 years");
  });

  it("never goes negative when the clock is behind the ledger", () => {
    expect(accountAge(before(-2), now)).toBe("0 days");
  });
});

describe("timeAgo", () => {
  const NOW = new Date("2026-05-01T12:00:00Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it("buckets into just now / minutes / hours / days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(timeAgo(ago(30_000))).toBe("Just now");
    expect(timeAgo(ago(5 * 60_000))).toBe("5m ago");
    expect(timeAgo(ago(59 * 60_000))).toBe("59m ago");
    expect(timeAgo(ago(60 * 60_000))).toBe("1h ago");
    expect(timeAgo(ago(23 * 3_600_000))).toBe("23h ago");
    expect(timeAgo(ago(3 * 86_400_000))).toBe("3d ago");
  });

  it("treats future timestamps (clock skew) as just now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(timeAgo(ago(-60_000))).toBe("Just now");
  });
});

describe("formatXrp", () => {
  it("applies K/M suffixes", () => {
    expect(formatXrp(1_500)).toBe("1.5K XRP");
    expect(formatXrp(2_340_000)).toBe("2.34M XRP");
  });

  it("rounds small values to whole XRP", () => {
    expect(formatXrp(42.6)).toBe(`${(43).toLocaleString()} XRP`);
    expect(formatXrp(0)).toBe("0 XRP");
  });

  it("keeps the sign on negative values", () => {
    expect(formatXrp(-1_500)).toBe("-1.5K XRP");
    expect(formatXrp(-2_000_000)).toBe("-2.00M XRP");
  });

  it("returns 0 XRP for non-finite input", () => {
    expect(formatXrp(NaN)).toBe("0 XRP");
    expect(formatXrp(Infinity)).toBe("0 XRP");
  });

  // Regression: the suffix used to be picked before rounding, so 999,999
  // printed "1000.0K XRP" instead of "1.00M XRP".
  it("rolls over to the next suffix at the rounding boundary", () => {
    expect(formatXrp(999_950)).toBe("1.00M XRP");
    expect(formatXrp(999_999)).toBe("1.00M XRP");
    expect(formatXrp(-999_999)).toBe("-1.00M XRP");
    expect(formatXrp(999.6)).toBe("1.0K XRP");
  });

  // Regression: the sign was taken before rounding, so -0.4 XRP printed "-0 XRP".
  it("does not print a negative zero", () => {
    expect(formatXrp(-0.4)).toBe("0 XRP");
    expect(formatXrp(-0)).toBe("0 XRP");
    expect(formatXrp(-0.6)).toBe("-1 XRP");
  });
});

describe("formatXrpValue", () => {
  it("scales precision with magnitude", () => {
    expect(formatXrpValue(0)).toBe("0");
    expect(formatXrpValue(0.0042)).toBe("0.004");
    expect(formatXrpValue(0.25)).toBe("0.25");
    expect(formatXrpValue(12.34)).toBe("12.3");
    expect(formatXrpValue(4_200)).toBe("4.2K");
    expect(formatXrpValue(3_100_000)).toBe("3.1M");
  });

  it("keeps the sign and guards non-finite input", () => {
    expect(formatXrpValue(-4_200)).toBe("-4.2K");
    expect(formatXrpValue(NaN)).toBe("0");
  });

  it("rolls over at the rounding boundary and never prints a negative zero", () => {
    expect(formatXrpValue(999_950)).toBe("1.0M");
    expect(formatXrpValue(999_990)).toBe("1.0M");
    expect(formatXrpValue(999.96)).toBe("1.0K");
    expect(formatXrpValue(-0.0001)).toBe("0.000");
  });
});

describe("formatVolume", () => {
  it("applies $ with K/M/B suffixes", () => {
    expect(formatVolume(12.5)).toBe("$12.50");
    expect(formatVolume(1_500)).toBe("$1.5K");
    expect(formatVolume(2_340_000)).toBe("$2.34M");
    expect(formatVolume(7_000_000_000)).toBe("$7.00B");
  });

  it("rolls over to the next suffix at the rounding boundary", () => {
    expect(formatVolume(999.999)).toBe("$1.0K");
    expect(formatVolume(999_950)).toBe("$1.00M");
    expect(formatVolume(999_999)).toBe("$1.00M");
    expect(formatVolume(999_999_999)).toBe("$1.00B");
  });

  it("puts the sign before the $ and drops it on zero", () => {
    expect(formatVolume(-1_500)).toBe("-$1.5K");
    expect(formatVolume(-0.001)).toBe("$0.00");
  });

  it("shows a dash for missing values", () => {
    expect(formatVolume(null)).toBe("—");
    expect(formatVolume(NaN)).toBe("—");
  });
});

describe("formatCompactNumber", () => {
  it("applies K/M/B/T suffixes", () => {
    expect(formatCompactNumber(1_500)).toBe("1.5K");
    expect(formatCompactNumber(2_340_000)).toBe("2.34M");
    expect(formatCompactNumber(7_000_000_000)).toBe("7.00B");
    expect(formatCompactNumber(1.2e12)).toBe("1.20T");
  });

  it("leaves small numbers unsuffixed, locale-formatted up to 2 decimals", () => {
    expect(formatCompactNumber(999)).toBe((999).toLocaleString());
    expect(formatCompactNumber(0)).toBe("0");
    expect(formatCompactNumber(12.345)).toBe((12.35).toLocaleString());
  });

  // Regression: the suffix used to be picked before rounding, so values just
  // under a boundary printed "1000.0K" instead of "1.00M".
  it("rolls over to the next suffix at the rounding boundary", () => {
    expect(formatCompactNumber(999_950)).toBe("1.00M");
    expect(formatCompactNumber(999_999)).toBe("1.00M");
    expect(formatCompactNumber(999.999)).toBe("1.0K");
    expect(formatCompactNumber(999_999_999)).toBe("1.00B");
    expect(formatCompactNumber(999_949)).toBe("999.9K");
  });

  it("compacts negatives and never prints a negative zero", () => {
    expect(formatCompactNumber(-1_500)).toBe("-1.5K");
    expect(formatCompactNumber(-999_950)).toBe("-1.00M");
    expect(formatCompactNumber(-0.001)).toBe("0");
    expect(formatCompactNumber(-0.001, { baseDecimals: 2 })).toBe("0.00");
  });

  it("shows a dash for missing or non-finite input", () => {
    expect(formatCompactNumber(null)).toBe("—");
    expect(formatCompactNumber(undefined)).toBe("—");
    expect(formatCompactNumber(NaN)).toBe("—");
    expect(formatCompactNumber(Infinity)).toBe("—");
  });

  it("uses one decimal count on every suffixed step", () => {
    expect(formatCompactNumber(2_340_000, { decimals: 1 })).toBe("2.3M");
    expect(formatCompactNumber(7_000_000_000, { decimals: 1 })).toBe("7.0B");
    // At 1 decimal, 999,950 rounds to 1000.0K, so it must move up to M.
    expect(formatCompactNumber(999_950, { decimals: 1 })).toBe("1.0M");
    expect(formatCompactNumber(999_949, { decimals: 1 })).toBe("999.9K");
  });

  it("uses fixed decimals below 1,000 and promotes when they round up", () => {
    expect(formatCompactNumber(42.6, { baseDecimals: 0 })).toBe("43");
    expect(formatCompactNumber(12.5, { baseDecimals: 2 })).toBe("12.50");
    expect(formatCompactNumber(999.6, { baseDecimals: 0 })).toBe("1.0K");
    expect(formatCompactNumber(-0.4, { baseDecimals: 0 })).toBe("0");
  });

  it("wraps the number in a prefix and suffix, with the sign first", () => {
    expect(formatCompactNumber(1_500, { prefix: "$" })).toBe("$1.5K");
    expect(formatCompactNumber(-2_340_000, { prefix: "$" })).toBe("-$2.34M");
    expect(formatCompactNumber(999_950, { suffix: " XRP" })).toBe("1.00M XRP");
    expect(formatCompactNumber(-0.001, { prefix: "$", baseDecimals: 0 })).toBe("$0");
  });

  it("can use an SI-style lowercase k", () => {
    expect(formatCompactNumber(1_500, { lowercaseK: true })).toBe("1.5k");
    expect(formatCompactNumber(999_950, { lowercaseK: true, decimals: 1 })).toBe("1.0M");
    expect(formatCompactNumber(999.96, { lowercaseK: true, baseDecimals: 1 })).toBe("1.0k");
  });

  it("can drop trailing zeros on suffixed values", () => {
    expect(formatCompactNumber(1_200_000, { trimZeros: true })).toBe("1.2M");
    expect(formatCompactNumber(3_000_000_000, { trimZeros: true })).toBe("3B");
    expect(formatCompactNumber(10_000_000, { trimZeros: true, decimals: 0 })).toBe("10M");
    expect(formatCompactNumber(999_999_999, { trimZeros: true })).toBe("1B");
    expect(formatCompactNumber(-1_234_567, { trimZeros: true })).toBe("-1.23M");
  });
});

describe("formatCompactCount", () => {
  it("uses one decimal on every suffixed step", () => {
    expect(formatCompactCount(842)).toBe("842");
    expect(formatCompactCount(12_460)).toBe("12.5K");
    expect(formatCompactCount(3_400_000)).toBe("3.4M");
    expect(formatCompactCount(2_100_000_000)).toBe("2.1B");
  });

  it("rolls over at the rounding boundary and never prints a negative zero", () => {
    expect(formatCompactCount(999_950)).toBe("1.0M");
    expect(formatCompactCount(999_950_000)).toBe("1.0B");
    expect(formatCompactCount(-0.001)).toBe("0");
  });
});

describe("formatChartDateTick", () => {
  const ts = Date.UTC(2026, 4, 1, 12, 30);

  it("shows a time for intraday windows", () => {
    expect(formatChartDateTick(ts, true)).toMatch(/^\d{1,2}:\d{2}\s(AM|PM)$/);
  });

  it("shows month and day for multi-day windows", () => {
    expect(formatChartDateTick(ts, false)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });
});

describe("formatInteger", () => {
  it("groups thousands", () => {
    expect(formatInteger(0)).toBe("0");
    expect(formatInteger(999)).toBe("999");
    expect(formatInteger(1_000)).toBe("1,000");
    expect(formatInteger(107_964_754)).toBe("107,964,754");
    expect(formatInteger(-1_234)).toBe("-1,234");
  });

  // rippled API v1 returns `ledger.ledger_index` as a string.
  it("accepts integer strings and bigints exactly", () => {
    expect(formatInteger("107964754")).toBe("107,964,754");
    expect(formatInteger(" 42 ")).toBe("42");
    expect(formatInteger("-0")).toBe("0");
    expect(formatInteger("123456789012345678901")).toBe("123,456,789,012,345,678,901");
    expect(formatInteger(10n ** 18n)).toBe("1,000,000,000,000,000,000");
  });

  it("rounds numbers and never prints a negative zero", () => {
    expect(formatInteger(12.6)).toBe("13");
    expect(formatInteger(-0.4)).toBe("0");
    expect(formatInteger(-0)).toBe("0");
  });

  it("shows a dash for missing or malformed input", () => {
    expect(formatInteger(null)).toBe("—");
    expect(formatInteger(undefined)).toBe("—");
    expect(formatInteger(NaN)).toBe("—");
    expect(formatInteger(Infinity)).toBe("—");
    expect(formatInteger("")).toBe("—");
    expect(formatInteger("12.5")).toBe("—");
    expect(formatInteger("abc")).toBe("—");
  });
});

describe("formatDropsAsXrp", () => {
  it("converts drops to grouped XRP and trims trailing zeros", () => {
    expect(formatDropsAsXrp("0")).toBe("0");
    expect(formatDropsAsXrp("1")).toBe("0.000001");
    expect(formatDropsAsXrp("1000000")).toBe("1");
    expect(formatDropsAsXrp("1500000")).toBe("1.5");
    expect(formatDropsAsXrp("1234567000000")).toBe("1,234,567");
    expect(formatDropsAsXrp(25_000_000)).toBe("25");
    expect(formatDropsAsXrp(10n ** 17n)).toBe("100,000,000,000");
  });

  // Regression: total_coins has 17 significant digits. Through a float it
  // printed "99985579589.39975"; the ledger header also never grouped it.
  it("keeps every digit of a ledger total", () => {
    expect(formatDropsAsXrp("99985579589399746")).toBe("99,985,579,589.399746");
  });

  it("keeps the sign on negative values", () => {
    expect(formatDropsAsXrp("-1500000")).toBe("-1.5");
    expect(formatDropsAsXrp("-1")).toBe("-0.000001");
    expect(formatDropsAsXrp("-0")).toBe("0");
  });

  it("shows a dash for missing or non-integer input", () => {
    expect(formatDropsAsXrp(null)).toBe("—");
    expect(formatDropsAsXrp(undefined)).toBe("—");
    expect(formatDropsAsXrp("")).toBe("—");
    expect(formatDropsAsXrp("1.5")).toBe("—");
    expect(formatDropsAsXrp("abc")).toBe("—");
    expect(formatDropsAsXrp(1.5)).toBe("—");
    expect(formatDropsAsXrp(NaN)).toBe("—");
  });
});

describe("formatScaled", () => {
  it.each([
    [1234500n, 2, "12,345"],
    [1234567n, 3, "1,234.567"],
    [5n, 4, "0.0005"],
    [-150n, 2, "-1.5"],
    [42n, 0, "42"],
  ])("%s at scale %s → %s", (n, scale, out) => {
    expect(formatScaled(n, scale)).toBe(out);
  });

  it("shows a dash for null", () => {
    expect(formatScaled(null, 2)).toBe("—");
  });
});

describe("parseDrops", () => {
  it("parses whole drops exactly, past float precision", () => {
    expect(parseDrops("99985579589399746")).toBe(99985579589399746n);
    expect(parseDrops(" -1500000 ")).toBe(-1500000n);
    expect(parseDrops(25_000_000)).toBe(25000000n);
    expect(parseDrops(7n)).toBe(7n);
  });

  it("returns null for anything that isn't a whole number", () => {
    for (const bad of [null, undefined, "", "1.5", "1e6", "abc", 1.5, NaN, Infinity]) {
      expect(parseDrops(bad)).toBeNull();
    }
  });
});

describe("splitDateTime", () => {
  it("splits at the first space", () => {
    expect(splitDateTime("2026-10-28 19:38:30 UTC")).toEqual({
      date: "2026-10-28",
      time: "19:38:30 UTC",
    });
  });

  it("returns a string without a space whole", () => {
    expect(splitDateTime("2026-10-28")).toEqual({ date: "2026-10-28", time: "" });
    expect(splitDateTime(" 2026-10-28 ")).toEqual({ date: "2026-10-28", time: "" });
  });
});
