// The home globe's arcs: every half second or so a streak of light leaves
// a place on the land facing out, runs along a great circle lifted off
// the surface to another, and sends a pulse out where it lands. They
// mean nothing. Each arc is a pure function of its number, so a given
// time always draws the same sky, for every viewer.
import { ACCENT, fadeAt, landAtPlace, pointAt, spinAt, viewOf, type GlobeView, type LatLon } from "./globe";
import { hash2 } from "./noise";

/**
 * - `every`: mean seconds between launches.
 * - `span`: how far apart the ends are, in radians (about 25°–75°).
 * - `lift`: how high the middle stands off the surface, in radii, at no
 *   span and per radian of it.
 * - `speed`: radians a second the head runs; `trail` radians of light
 *   follow it, at most `trailMax` of the span, two cells thick where
 *   it's brighter than `bold`.
 * - `path`: how dense the arc's path runs behind the streak; it fades
 *   over `fade` seconds once the streak is in.
 * - `pulse`: seconds the landing pulse runs, and how far out it goes in
 *   cells.
 */
export const ARC = {
  every: 0.5,
  span: [0.45, 1.3],
  lift: [0.05, 0.4],
  speed: 0.8,
  trail: 0.5,
  trailMax: 0.6,
  bold: 0.6,
  path: 0.22,
  fade: 0.6,
  pulse: { life: 0.75, size: 6 },
} as const;

export interface Arc {
  from: LatLon;
  to: LatLon;
  /** Globe time it leaves, in seconds. */
  born: number;
  /** The angle between its ends, in radians. */
  span: number;
}

/** Ordered dither along a line: a cell `j` steps along it draws when
 *  its weight × 16 beats `LINE[j % 16]`, so a thin path thins into
 *  evenly spaced dots whichever way it runs. */
const LINE = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];

/** Seconds the head takes from end to end, and the trail's length as a
 *  share of the span. */
const runOf = (span: number) => span / ARC.speed;
const trailOf = (span: number) => Math.min(ARC.trailMax, ARC.trail / span);

/** How long an arc shows: until its path has faded and its pulse run. */
export const arcLife = (span: number) =>
  Math.max(runOf(span) * (1 + trailOf(span)) + ARC.fade, runOf(span) + ARC.pulse.life);

const LONGEST = arcLife(ARC.span[1]);

/** Places tried for each arc's ends. */
const TRIES = 48;

/** A place on the face in view at turn `spin`, from two numbers in
 *  [0, 1): spread evenly over the middle 85% of the disc. */
function facePlace(u: number, v: number, spin: number): LatLon {
  const r = 0.85 * Math.sqrt(u);
  return pointAt(r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v), spin)!;
}

/** The angle between two places, in radians. */
function angle(p: LatLon, q: LatLon): number {
  const [a, b] = [viewOf(p, 0), viewOf(q, 0)];
  return Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
}

/** The first two of `places` a span apart, as an arc leaving at `born`. */
function pairUp(places: readonly LatLon[], born: number): Arc | null {
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      const span = angle(places[i], places[j]);
      if (span >= ARC.span[0] && span <= ARC.span[1]) return { from: places[i], to: places[j], born, span };
    }
  }
  return null;
}

/** Arc number `k`: two places on land, in view when it leaves, a span
 *  apart. When the face has too little land (the Pacific), sea will do. */
export function arcAt(k: number, land: Uint8Array, seed: number): Arc {
  const born = (k + 0.8 * hash2(k, 0, seed)) * ARC.every;
  const spin = spinAt(born);
  const places = Array.from({ length: TRIES }, (_, n) =>
    facePlace(hash2(k, 2 * n + 1, seed), hash2(k, 2 * n + 2, seed), spin),
  );
  const ashore = places.filter((p) => landAtPlace(land, p) > 0.5);
  return (
    pairUp(ashore, born) ??
    pairUp(places, born) ?? { from: places[0], to: places[1], born, span: angle(places[0], places[1]) }
  );
}

/** The arcs showing at `t`. */
export function liveArcs(t: number, land: Uint8Array, seed: number): Arc[] {
  const arcs: Arc[] = [];
  for (let k = Math.floor((t - LONGEST) / ARC.every) - 1; k <= Math.floor(t / ARC.every); k++) {
    const arc = arcAt(k, land, seed);
    if (t >= arc.born && t - arc.born < arcLife(arc.span)) arcs.push(arc);
  }
  return arcs;
}

/** Draws `arcs` over a globe frame in `out`, in the accent: each one's
 *  path, its streak, the place it left and, once it lands, a pulse. */
export function drawArcs(out: Uint8Array, view: GlobeView, arcs: readonly Arc[], t: number): void {
  const { cols, rows, cx, cy, radius, clear } = view;
  const spin = spinAt(t);
  let j = 0;
  // One cell, dithered along whatever line it's on.
  const put = (x: number, y: number, weight: number) => {
    j++;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    if (weight * fadeAt(x, y, clear) * 16 > LINE[j & 15]) out[y * cols + x] = ACCENT;
  };
  // A square ring `half` cells out from (x, y).
  const ring = (x: number, y: number, half: number, weight: number) => {
    for (let d = -half; d < half; d++) {
      put(x + d, y - half, weight);
      put(x + half, y + d, weight);
      put(x - d, y + half, weight);
      put(x - half, y - d, weight);
    }
  };
  const cell = (p: readonly number[]): [number, number] => [
    Math.floor(cx + p[0] * radius),
    Math.floor(cy - p[1] * radius),
  ];

  for (const arc of arcs) {
    const age = t - arc.born;
    if (age < 0) continue;
    const run = runOf(arc.span);
    const trail = trailOf(arc.span);
    const head = age / run;
    const gone = Math.max(0, age - run * (1 + trail)) / ARC.fade;
    const a = viewOf(arc.from, spin);
    const b = viewOf(arc.to, spin);

    if (gone < 1) {
      const lift = ARC.lift[0] + ARC.lift[1] * arc.span;
      const sin = Math.sin(arc.span);
      const steps = Math.ceil(2 * arc.span * radius * (1 + lift));
      let last = -1;
      j = 0;
      for (let n = 0; n <= steps && n / steps <= head; n++) {
        const s = n / steps;
        // Along the great circle, lifted most at the middle.
        const r = (1 + lift * Math.sin(Math.PI * s)) / sin;
        const wa = r * Math.sin((1 - s) * arc.span);
        const wb = r * Math.sin(s * arc.span);
        const px = wa * a[0] + wb * b[0];
        const py = wa * a[1] + wb * b[1];
        const pz = wa * a[2] + wb * b[2];
        const [x, y] = cell([px, py]);
        if (y * cols + x === last) continue;
        last = y * cols + x;
        // Behind the globe.
        const flat = px * px + py * py;
        if (flat < 1 && pz < Math.sqrt(1 - flat) - 1e-6) {
          j++;
          continue;
        }
        const lit = s > head - trail ? (s - head + trail) / trail : 0;
        const weight = Math.max(lit, ARC.path * (1 - gone));
        put(x, y, weight);
        // The bright end of the streak runs two cells thick.
        if (lit > ARC.bold) {
          put(x + 1, y, weight);
          put(x, y + 1, weight);
          put(x + 1, y + 1, weight);
        }
      }
    }

    // Its ends while its path shows (the far one once it's reached), and
    // a pulse going out where it lands.
    j = 0;
    const landed = (age - run) / ARC.pulse.life;
    if (gone < 1 && a[2] > 0) ring(...cell(a), 1, 1);
    if (landed >= 0 && b[2] > 0) {
      const [x, y] = cell(b);
      if (gone < 1) ring(x, y, 1, 1);
      if (landed < 1) ring(x, y, 1 + Math.floor(landed * ARC.pulse.size), 1 - landed);
    }
  }
}
