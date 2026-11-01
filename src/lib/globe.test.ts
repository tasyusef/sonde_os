import { describe, expect, it } from "vitest";
import { LAND_RUNS } from "@/components/home/Globe/land";
import {
  CLEAR,
  decodeRuns,
  discRadius,
  encodeRuns,
  fadeAt,
  globeFrame,
  globeView,
  INK,
  LAND_H,
  LAND_W,
  landAt,
  landAtPlace,
  pointAt,
  TILT,
  viewOf,
} from "./globe";

const land = decodeRuns(LAND_RUNS);

/** The mask cell holding a latitude and longitude, in degrees. */
const cellAt = (lat: number, lon: number) =>
  Math.floor(((90 - lat) / 180) * LAND_H) * LAND_W + Math.floor(((lon + 180) / 360) * LAND_W);

describe("land mask", () => {
  it("round-trips rows through the run encoding, land-first rows and long runs too", () => {
    const rows = Array.from({ length: LAND_H }, (_, r) =>
      Uint8Array.from({ length: LAND_W }, (_, c) => ((c * 7 + r * 13) % 97 < 40 + (r % 3) * 20 ? 1 : 0)),
    );
    rows[0].fill(1);
    rows[1].fill(0);
    const decoded = decodeRuns(encodeRuns(rows));
    rows.forEach((row, r) => expect(decoded.subarray(r * LAND_W, (r + 1) * LAND_W)).toEqual(row));
  });

  it("puts land and sea where they are", () => {
    expect(land[cellAt(0, 20)]).toBe(1); // Congo basin
    expect(land[cellAt(40, -100)]).toBe(1); // Kansas
    expect(land[cellAt(-85, 0)]).toBe(1); // Antarctica
    expect(land[cellAt(0, -150)]).toBe(0); // Pacific
    expect(land[cellAt(30, -40)]).toBe(0); // Atlantic
  });

  it("blends the coast between neighbouring cells and wraps at the antimeridian", () => {
    const row = Math.floor((90 / 180) * LAND_H) + 0.5;
    for (let col = 0; col < LAND_W; col += 0.25) {
      const v = landAt(land, row, col);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(landAt(land, row, -0.5)).toBeCloseTo(landAt(land, row, LAND_W - 0.5));
  });
});

describe("layout", () => {
  it("spans 84% of the short side", () => {
    expect(2 * discRadius(600, 420)).toBeCloseTo(0.84 * 420);
    expect(2 * discRadius(195, 195)).toBeCloseTo(0.84 * 195);
  });

  it("stays blank round the clearing, then dithers back in over the feather", () => {
    const clear = { x0: 40, y0: 40, x1: 60, y1: 50 };
    expect(fadeAt(100, 100, null)).toBe(1);
    expect(fadeAt(50, 45, clear)).toBe(0);
    expect(fadeAt(60 + CLEAR.margin, 45, clear)).toBe(0);
    expect(fadeAt(60 + CLEAR.margin + CLEAR.feather / 2, 45, clear)).toBeCloseTo(0.5);
    expect(fadeAt(50, 50 + CLEAR.margin + CLEAR.feather, clear)).toBe(1);
  });

  it("faces the viewer at the tilt's latitude, and finds nothing off the disc", () => {
    const at = pointAt(0, 0, 0.5);
    expect(at?.lat).toBeCloseTo(TILT);
    expect(at?.lon).toBeCloseTo(-0.5);
    expect(pointAt(0.8, 0.8, 0)).toBeNull();
  });

  it("puts a place back where it was found", () => {
    const at = pointAt(-0.3, 0.4, 1.2)!;
    const [x, y, z] = viewOf(at, 1.2);
    expect(x).toBeCloseTo(-0.3);
    expect(y).toBeCloseTo(0.4);
    expect(z).toBeGreaterThan(0);
    expect(landAtPlace(land, { lat: 0, lon: (20 * Math.PI) / 180 })).toBe(1); // Congo basin
  });
});

describe("globeFrame", () => {
  const cols = 200;
  const rows = 200;
  const radius = discRadius(cols, rows);
  const clear = { x0: 90, y0: 95, x1: 110, y1: 105 };
  const view = globeView(cols, rows, cols / 2, rows / 2, radius, clear);
  const frame = new Uint8Array(cols * rows);
  const count = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (frame[y * cols + x] === INK) n++;
    return n;
  };

  it("draws only on the disc and its halo, and leaves the clearing blank", () => {
    globeFrame(frame, view, land, 0);
    expect(count(clear.x0, clear.y0, clear.x1 + 1, clear.y1 + 1)).toBe(0);
    expect(count(0, 0, 10, 10)).toBe(0);
    expect(count(0, 0, cols, rows)).toBeGreaterThan(0);
  });

  it("runs the sea thicker toward the rim than face-on", () => {
    // An all-sea mask leaves only the sea's own shading.
    globeFrame(frame, view, new Uint8Array(LAND_W * LAND_H), 0);
    const r = Math.round(radius);
    const middle = count(cols / 2 - 10, rows / 2 - 30, cols / 2 + 10, rows / 2 - 10);
    const rim = count(cols / 2 - 10, rows / 2 - r + 2, cols / 2 + 10, rows / 2 - r + 22);
    expect(rim).toBeGreaterThan(middle);
  });

  it("draws land denser than sea", () => {
    globeFrame(frame, view, new Uint8Array(LAND_W * LAND_H), 0);
    const sea = count(60, 60, 90, 90);
    globeFrame(frame, view, new Uint8Array(LAND_W * LAND_H).fill(1), 0);
    expect(count(60, 60, 90, 90)).toBeGreaterThan(2 * sea);
  });
});
