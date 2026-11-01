// The home globe, as numbers: which cells of a dithered, lit, turning
// Earth draw on a given frame. Its arcs are in `globe-arcs.ts`, the canvas
// side in `components/home/Globe`. Units are cells, radians and seconds.
import { dithered4 } from "./noise";

/** The land mask's grid: half-degree cells, row 0 at the north edge,
 *  column 0 at 180°W. */
export const LAND_W = 720;
export const LAND_H = 360;

/** The globe leans its north pole 18° toward the viewer. */
export const TILT = (18 * Math.PI) / 180;

/** Radians a second it turns (6°, once a minute), and where it starts:
 *  Africa and Europe facing out. */
export const SPIN = { rate: Math.PI / 30, start: -0.3 } as const;

/** Lit from 300° round from the top (the upper left), 50° off the line
 *  of sight, in view space (x right, y up, z out). */
const LIGHT = (() => {
  const round = (300 * Math.PI) / 180;
  const off = (50 * Math.PI) / 180;
  return [Math.sin(round) * Math.sin(off), Math.cos(round) * Math.sin(off), Math.cos(off)] as const;
})();

/** How dense the dither runs, 0–1. Land runs `day` in full light down
 *  to `night`, a sparse grid, past the terminator. Sea runs `sea`
 *  face-on, thickening by `rim` toward the edge, and dims to `dark` of
 *  that at night. The halo stands `halo` radii off the lit rim, `haloPeak`
 *  dense where it meets the disc. */
export const SHADE = {
  day: 0.85,
  night: 0.13,
  sea: 0.14,
  rim: 0.3,
  dark: 0.45,
  halo: 0.04,
  haloPeak: 0.4,
} as const;

/** Round the search the globe stays blank `margin` cells out, then
 *  dithers back in over `feather`. */
export const CLEAR = { margin: 3, feather: 4 } as const;

/** The cells the globe keeps clear of (the search), inclusive. */
export interface ClearBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Frame cell values. */
export const INK = 1;
export const ACCENT = 2;

/* ——— Land mask ———
 * Each row is runs of ocean then land, alternating, ocean first (a row
 * that opens on land starts with a 0 run). A run is a varint in the
 * base64url alphabet: 5 bits a character, the sixth bit set while more
 * follow. Rows run to `LAND_W` cells, so they need no separator. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function encodeRuns(rows: readonly Uint8Array[]): string {
  let out = "";
  const put = (n: number) => {
    do {
      const low = n & 31;
      n >>>= 5;
      out += ALPHABET[n ? low | 32 : low];
    } while (n);
  };
  for (const row of rows) {
    let value = 0;
    let run = 0;
    for (const cell of row) {
      if (cell === value) run++;
      else {
        put(run);
        value = cell;
        run = 1;
      }
    }
    put(run);
  }
  return out;
}

/** The mask as `LAND_W × LAND_H` cells, row-major, 1 for land. */
export function decodeRuns(runs: string): Uint8Array {
  const land = new Uint8Array(LAND_W * LAND_H);
  let i = 0;
  let at = 0;
  let rowEnd = LAND_W;
  let value = 0;
  while (i < runs.length) {
    let n = 0;
    let shift = 0;
    let c: number;
    do {
      c = ALPHABET.indexOf(runs[i++]);
      n |= (c & 31) << shift;
      shift += 5;
    } while (c & 32);
    if (value) land.fill(1, at, at + n);
    at += n;
    if (at === rowEnd) {
      // The next row opens on ocean.
      rowEnd += LAND_W;
      value = 0;
    } else value ^= 1;
  }
  return land;
}

/** How much land is at a point of the mask (in its cell units, row and
 *  column), blended from the four nearest cells so coasts come out
 *  smooth. Columns wrap; rows stop at the poles. */
export function landAt(land: Uint8Array, row: number, col: number): number {
  const v = Math.min(LAND_H - 1, Math.max(0, row - 0.5));
  const u = col - 0.5;
  const r0 = Math.floor(v);
  const c0 = Math.floor(u);
  const fy = v - r0;
  const fx = u - c0;
  const r1 = Math.min(LAND_H - 1, r0 + 1);
  const a = ((c0 % LAND_W) + LAND_W) % LAND_W;
  const b = (a + 1) % LAND_W;
  const top = land[r0 * LAND_W + a] * (1 - fx) + land[r0 * LAND_W + b] * fx;
  const bottom = land[r1 * LAND_W + a] * (1 - fx) + land[r1 * LAND_W + b] * fx;
  return top * (1 - fy) + bottom * fy;
}

/* ——— View ——— */

/** Everything about a cell that stays put while the globe turns. */
export interface GlobeView {
  cols: number;
  rows: number;
  /** The disc's centre and radius, in cells. */
  cx: number;
  cy: number;
  radius: number;
  clear: ClearBox | null;
  /** Cells on the disc, and for each one: its frame index, its mask row
   *  and unturned column, how dense it runs as land and as sea, and how
   *  much of it shows (0–1, see `fadeAt`). */
  disc: Int32Array;
  row: Float32Array;
  col: Float32Array;
  land: Float32Array;
  sea: Float32Array;
  fade: Float32Array;
  /** Cells in the halo round the disc and how dense each one runs. */
  halo: Int32Array;
  haloTone: Float32Array;
}

const COS_TILT = Math.cos(TILT);
const SIN_TILT = Math.sin(TILT);

/** A point on the visible face, in view space (y up), back on the
 *  unturned globe. */
function unturn(vx: number, vy: number): [number, number, number] {
  const vz = Math.sqrt(Math.max(0, 1 - vx * vx - vy * vy));
  return [vx, vy * COS_TILT + vz * SIN_TILT, vz * COS_TILT - vy * SIN_TILT];
}

/** The globe's radius for a `cols × rows` box: it spans 84% of the
 *  short side. */
export function discRadius(cols: number, rows: number): number {
  return 0.42 * Math.min(cols, rows);
}

/** How much of the globe shows at a cell: none within `CLEAR.margin`
 *  of `clear`, all of it a feather further out. Square, like everything
 *  else here. */
export function fadeAt(x: number, y: number, clear: ClearBox | null): number {
  if (!clear) return 1;
  const out = Math.max(clear.x0 - x, x - clear.x1, clear.y0 - y, y - clear.y1);
  return Math.min(1, Math.max(0, (out - CLEAR.margin) / CLEAR.feather));
}

/** Lays the globe out: a disc of `radius` cells centred at (cx, cy),
 *  kept clear of `clear`. */
export function globeView(
  cols: number,
  rows: number,
  cx: number,
  cy: number,
  radius: number,
  clear: ClearBox | null,
): GlobeView {
  // Only the square round the halo can hold either.
  const reach = radius * (1 + SHADE.halo);
  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(cols, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const y1 = Math.min(rows, Math.ceil(cy + reach));
  const size = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const disc = new Int32Array(size);
  const row = new Float32Array(size);
  const col = new Float32Array(size);
  const land = new Float32Array(size);
  const sea = new Float32Array(size);
  const fade = new Float32Array(size);
  const halo = new Int32Array(size);
  const haloTone = new Float32Array(size);
  let n = 0;
  let h = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const vx = (x + 0.5 - cx) / radius;
      const vy = -(y + 0.5 - cy) / radius;
      const d = Math.hypot(vx, vy);
      const shows = fadeAt(x, y, clear);
      if (d < 1) {
        const [px, py, pz] = unturn(vx, vy);
        const vz = Math.sqrt(1 - d * d);
        const lit = Math.max(0, vx * LIGHT[0] + vy * LIGHT[1] + vz * LIGHT[2]);
        const edge = 1 - vz;
        disc[n] = y * cols + x;
        row[n] = ((Math.PI / 2 - Math.asin(py)) / Math.PI) * LAND_H;
        col[n] = ((Math.atan2(px, pz) + Math.PI) / (2 * Math.PI)) * LAND_W;
        land[n] = SHADE.night + (SHADE.day - SHADE.night) * lit;
        sea[n] = (SHADE.sea + SHADE.rim * edge * edge) * (SHADE.dark + (1 - SHADE.dark) * lit);
        fade[n] = shows;
        n++;
      } else if (d < 1 + SHADE.halo) {
        // The rim catches the light on its sunward side only.
        const lit = Math.max(0, (vx * LIGHT[0] + vy * LIGHT[1]) / d);
        halo[h] = y * cols + x;
        haloTone[h] = SHADE.haloPeak * (1 - (d - 1) / SHADE.halo) * lit * shows;
        h++;
      }
    }
  }
  return {
    cols,
    rows,
    cx,
    cy,
    radius,
    clear,
    disc: disc.slice(0, n),
    row: row.slice(0, n),
    col: col.slice(0, n),
    land: land.slice(0, n),
    sea: sea.slice(0, n),
    fade: fade.slice(0, n),
    halo: halo.slice(0, h),
    haloTone: haloTone.slice(0, h),
  };
}

/** How far the globe has turned at time `t`. Turning east carries the
 *  face westward under the viewer. */
export const spinAt = (t: number) => SPIN.start + SPIN.rate * t;

/** A place on the globe, in radians. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** The surface point under view-space (vx, vy) at turn `spin`, or null
 *  off the disc. */
export function pointAt(vx: number, vy: number, spin: number): LatLon | null {
  if (vx * vx + vy * vy >= 1) return null;
  const [gx, gy, gz] = unturn(vx, vy);
  return { lat: Math.asin(gy), lon: Math.atan2(gx, gz) - spin };
}

/** Where a place is in view space at turn `spin`: a unit vector, facing
 *  the viewer when z > 0. `pointAt`, the other way round. */
export function viewOf({ lat, lon }: LatLon, spin: number): [number, number, number] {
  const gx = Math.cos(lat) * Math.sin(lon + spin);
  const gy = Math.sin(lat);
  const gz = Math.cos(lat) * Math.cos(lon + spin);
  return [gx, gy * COS_TILT - gz * SIN_TILT, gz * COS_TILT + gy * SIN_TILT];
}

/** How much land is at a place (0–1). */
export const landAtPlace = (land: Uint8Array, { lat, lon }: LatLon) =>
  landAt(land, ((Math.PI / 2 - lat) / Math.PI) * LAND_H, ((lon + Math.PI) / (2 * Math.PI)) * LAND_W);

/** Writes the globe into `out` (`cols × rows`, row-major): `INK` or 0
 *  for a blank cell. */
export function globeFrame(out: Uint8Array, view: GlobeView, land: Uint8Array, t: number): void {
  out.fill(0);
  const { cols, disc, halo, haloTone } = view;
  const shift = (spinAt(t) / (2 * Math.PI)) * LAND_W;
  for (let k = 0; k < disc.length; k++) {
    const shows = view.fade[k];
    if (!shows) continue;
    const i = disc[k];
    const x = i % cols;
    const m = landAt(land, view.row[k], view.col[k] - shift);
    const tone = shows * (view.sea[k] + (view.land[k] - view.sea[k]) * m);
    if (dithered4(x, (i - x) / cols, tone)) out[i] = INK;
  }
  for (let k = 0; k < halo.length; k++) {
    const i = halo[k];
    const x = i % cols;
    if (dithered4(x, (i - x) / cols, haloTone[k])) out[i] = INK;
  }
}
