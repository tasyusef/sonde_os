import { describe, expect, it } from "vitest";
import { fitTabs, type TabMetrics } from "./fitTabs";

// Five 100px tabs, 24px gaps, a 72px More trigger.
const metrics = (available: number, widths = [100, 100, 100, 100, 100]): TabMetrics => ({
  widths,
  available,
  gap: 24,
  moreWidth: 72,
});

describe("fitTabs", () => {
  it("shows every tab when they all fit, More included or not", () => {
    // 5 * 100 + 4 * 24 = 596
    expect(fitTabs(metrics(596), 0)).toEqual([0, 1, 2, 3, 4]);
    expect(fitTabs(metrics(1000), 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps the prefix that fits beside More when the active tab is in it", () => {
    // budget = 400 - 24 - 72 = 304 → 100 + 24 + 100 = 224 fits, a third (348) doesn't
    expect(fitTabs(metrics(400), 0)).toEqual([0, 1]);
    expect(fitTabs(metrics(400), 1)).toEqual([0, 1]);
  });

  it("promotes an overflowing active tab into the strip, keeping tab order", () => {
    expect(fitTabs(metrics(400), 4)).toEqual([0, 4]);
    expect(fitTabs(metrics(400), 2)).toEqual([0, 2]);
  });

  it("reserves the active tab's real width before filling the rest", () => {
    // Active "Profile" is 200px: 200 + 24 + 100 = 324 > 304, so only it shows.
    expect(fitTabs(metrics(400, [100, 100, 100, 100, 200]), 4)).toEqual([4]);
  });

  it("does not claim a fit when only the last tab is too wide", () => {
    // Old measurement let the last tab through whenever the ones before it fit beside More.
    // 100 + 24 + 100 + 24 + 150 = 398 > 380
    expect(fitTabs(metrics(380, [100, 100, 150]), 0)).toEqual([0, 1]);
  });

  it("always shows at least one tab", () => {
    expect(fitTabs(metrics(50), 3)).toEqual([3]);
    expect(fitTabs(metrics(50), -1)).toEqual([0]);
  });

  it("falls back to the plain prefix when the active id isn't a tab", () => {
    expect(fitTabs(metrics(400), -1)).toEqual([0, 1]);
  });

  it("handles no tabs", () => {
    expect(fitTabs(metrics(400, []), -1)).toEqual([]);
  });
});
