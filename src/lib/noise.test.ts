import { describe, expect, it } from "vitest";
import { BAYER8, dithered, dithered4, hash2 } from "./noise";

describe("noise", () => {
  it("hashes deterministically into [0, 1)", () => {
    expect(hash2(3, 4, 7)).toBe(hash2(3, 4, 7));
    for (let i = 0; i < 200; i++) {
      const v = hash2(i, i * 3, 11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("builds a Bayer matrix holding each of 0–63 once", () => {
    expect([...BAYER8.flat()].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it("dithers more cells in as weight rises, none at 0 and all at 1", () => {
    const kept = (w: number) => BAYER8.flat().filter((_, i) => dithered(i % 8, i >> 3, w)).length;
    expect(kept(0)).toBe(0);
    expect(kept(0.5)).toBe(32);
    expect(kept(1)).toBe(64);
  });

  it("dithers on the 4×4 matrix too: a quarter of each tile at 0.25, every cell at 1", () => {
    const kept = (w: number) =>
      Array.from({ length: 16 }, (_, i) => dithered4(i % 4, i >> 2, w)).filter(Boolean).length;
    expect(kept(0)).toBe(0);
    expect(kept(0.25)).toBe(4);
    expect(kept(1)).toBe(16);
    // It repeats every four cells.
    expect(dithered4(5, 6, 0.4)).toBe(dithered4(1, 2, 0.4));
  });
});
