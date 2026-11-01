import { describe, expect, it } from "vitest";
import { MARK_CELLS, MARKS } from "./marks";

describe("MARKS", () => {
  it("draws every mark on the full square grid, in on and off cells only", () => {
    for (const [name, rows] of Object.entries(MARKS)) {
      expect(rows, name).toHaveLength(MARK_CELLS);
      for (const row of rows) expect(row, name).toMatch(new RegExp(`^[#.]{${MARK_CELLS}}$`));
      expect(rows.join(""), name).toContain("#");
    }
  });

  it("keeps the symmetric marks mirror-true", () => {
    const mirrored = (rows: readonly string[]) => rows.every((r) => r === [...r].reverse().join(""));
    const symmetric = [
      "network", "star", "star-filled", "book", "info", "menu", "close", "plus", "minus",
      "chevron-down", "chevron-up", "download", "sun", "flame",
    ] as const;
    for (const name of symmetric) {
      expect(mirrored(MARKS[name]), name).toBe(true);
    }
  });

  it("mirrors left and right, and keeps up and down in one band", () => {
    const flip = (rows: readonly string[]) => rows.map((r) => [...r].reverse().join(""));
    expect(flip(MARKS["chevron-left"])).toEqual([...MARKS["chevron-right"]]);
    expect(flip(MARKS["arrow-left"])).toEqual([...MARKS.arrow]);
    const band = (rows: readonly string[]) => rows.flatMap((r, y) => (r.includes("#") ? [y] : []));
    expect(band(MARKS["chevron-up"])).toEqual(band(MARKS["chevron-down"]));
  });
});
