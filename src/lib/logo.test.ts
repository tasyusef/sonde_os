import { describe, expect, it } from "vitest";
import { MARK, MARK_SMALL, WORDMARK_H, WORDMARK_PATHS, WORDMARK_W } from "./logo";

describe("logo bitmaps", () => {
  it.each([
    ["MARK", MARK],
    ["MARK_SMALL", MARK_SMALL],
  ])("%s is square and mirror-symmetric", (_, mark) => {
    for (const row of mark) {
      expect(row).toHaveLength(mark.length);
      expect([...row].reverse().join("")).toBe(row);
    }
  });

  it("sets SONDE on the 11-cell caps", () => {
    expect(WORDMARK_PATHS).toHaveLength(5);
    expect([WORDMARK_W, WORDMARK_H]).toEqual([63, 11]);
  });
});
