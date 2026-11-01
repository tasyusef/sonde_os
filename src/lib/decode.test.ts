import { describe, expect, it } from "vitest";
import { decodeFrame, mulberry32, POOL, seedOf, settledAt } from "./decode";

const HASH = "E3FE6EA3D48F0C2B639448020EA4F03D4F4F8FFDB243A852A0F59177921B4879";
const FRAMES = 12;

describe("mulberry32", () => {
  it("draws the same run for a seed, in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("seedOf", () => {
  it("is stable per text and differs between texts", () => {
    expect(seedOf(HASH)).toBe(seedOf(HASH));
    expect(seedOf("rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY")).not.toBe(seedOf(HASH));
  });
});

describe("settledAt", () => {
  it("runs from none to all, evenly, whatever the length", () => {
    expect(settledAt(64, 0, FRAMES)).toBe(0);
    expect(settledAt(64, FRAMES / 2, FRAMES)).toBe(32);
    expect(settledAt(64, FRAMES, FRAMES)).toBe(64);
    expect(settledAt(34, FRAMES + 5, FRAMES)).toBe(34);
    expect(settledAt(34, -1, FRAMES)).toBe(0);
  });

  it("never goes back a character", () => {
    let last = 0;
    for (let f = 0; f <= FRAMES; f++) {
      const n = settledAt(34, f, FRAMES);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });
});

describe("decodeFrame", () => {
  const seed = seedOf(HASH);

  it("keeps the length on every frame", () => {
    for (let f = 0; f <= FRAMES; f++) {
      expect(decodeFrame(HASH, f, FRAMES, seed)).toHaveLength(HASH.length);
    }
  });

  it("starts all glyphs and ends on the text", () => {
    expect([...decodeFrame(HASH, 0, FRAMES, seed)].every((c) => POOL.includes(c))).toBe(true);
    expect(decodeFrame(HASH, FRAMES, FRAMES, seed)).toBe(HASH);
  });

  it("settles left to right", () => {
    const f = FRAMES / 2;
    const out = decodeFrame(HASH, f, FRAMES, seed);
    const settled = settledAt(HASH.length, f, FRAMES);
    expect(out.slice(0, settled)).toBe(HASH.slice(0, settled));
    expect([...out.slice(settled)].every((c) => POOL.includes(c))).toBe(true);
  });

  it("holds punctuation and spaces in place", () => {
    const out = decodeFrame("rPx92...4kF7 1,024.5", 0, FRAMES, 7);
    expect(out.slice(5, 8)).toBe("...");
    expect(out[12]).toBe(" ");
    expect(out[14]).toBe(",");
    expect(out[18]).toBe(".");
  });

  it("is pure, and draws fresh glyphs each frame", () => {
    expect(decodeFrame(HASH, 3, FRAMES, seed)).toBe(decodeFrame(HASH, 3, FRAMES, seed));
    expect(decodeFrame(HASH, 1, FRAMES, seed).slice(-20)).not.toBe(
      decodeFrame(HASH, 2, FRAMES, seed).slice(-20),
    );
  });
});
