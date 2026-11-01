import { describe, expect, it } from "vitest";
import { LAND_RUNS } from "@/components/home/Globe/land";
import { ACCENT, decodeRuns, discRadius, globeView, landAtPlace, spinAt, viewOf } from "./globe";
import { ARC, arcAt, arcLife, drawArcs, liveArcs } from "./globe-arcs";

const land = decodeRuns(LAND_RUNS);
const SEED = 7;

describe("arcs", () => {
  it("draws the same arc for the same number", () => {
    expect(arcAt(42, land, SEED)).toEqual(arcAt(42, land, SEED));
    expect(arcAt(42, land, SEED)).not.toEqual(arcAt(43, land, SEED));
  });

  it("runs between places in view when it leaves, a span apart, nearly always on land", () => {
    let ashore = 0;
    for (let k = -20; k < 220; k++) {
      const arc = arcAt(k, land, SEED);
      expect(arc.span).toBeGreaterThanOrEqual(ARC.span[0]);
      expect(arc.span).toBeLessThanOrEqual(ARC.span[1]);
      expect(viewOf(arc.from, spinAt(arc.born))[2]).toBeGreaterThan(0);
      expect(viewOf(arc.to, spinAt(arc.born))[2]).toBeGreaterThan(0);
      if (landAtPlace(land, arc.from) > 0.5 && landAtPlace(land, arc.to) > 0.5) ashore++;
    }
    // Only a face of nearly all Pacific puts an end at sea.
    expect(ashore / 240).toBeGreaterThan(0.95);
  });

  it("keeps a few in the air at any time, from the first frame on", () => {
    for (let t = 0; t < 30; t += 0.25) {
      const arcs = liveArcs(t, land, SEED);
      expect(arcs.length).toBeGreaterThanOrEqual(2);
      for (const arc of arcs) {
        expect(t).toBeGreaterThanOrEqual(arc.born);
        expect(t - arc.born).toBeLessThan(arcLife(arc.span));
      }
    }
  });
});

describe("drawArcs", () => {
  const cols = 200;
  const rows = 200;
  const frame = new Uint8Array(cols * rows);
  const count = (out: Uint8Array) => out.reduce((n, v) => n + (v === ACCENT ? 1 : 0), 0);
  const view = globeView(cols, rows, cols / 2, rows / 2, discRadius(cols, rows), null);
  const arc = arcAt(3, land, SEED);
  const run = arc.span / ARC.speed;

  it("draws nothing before an arc leaves, and its streak once it's under way", () => {
    frame.fill(0);
    drawArcs(frame, view, [arc], arc.born - 0.1);
    expect(count(frame)).toBe(0);
    drawArcs(frame, view, [arc], arc.born + run / 2);
    expect(count(frame)).toBeGreaterThan(10);
  });

  it("keeps clear of the clearing", () => {
    const cleared = globeView(cols, rows, cols / 2, rows / 2, discRadius(cols, rows), {
      x0: 0,
      y0: 0,
      x1: cols - 1,
      y1: rows - 1,
    });
    frame.fill(0);
    drawArcs(frame, cleared, [arc], arc.born + run / 2);
    expect(count(frame)).toBe(0);
  });
});
