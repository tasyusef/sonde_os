// The app icon: the mark in the coral on a square of the dark page,
// drawn cell by cell so every size is exact (`scripts/brand.ts`).
import { BRAND, GROUND } from "./brand-colors";
import { MARK, MARK_SMALL } from "./logo";
import { hexToRgb } from "./oklch";

/** Up to this size, the small mark (tabs show 16, or 32 on 2x screens). */
const SMALL_UP_TO = 48;
/** A maskable icon's safe circle, as a share of its size. */
const SAFE_RADIUS = 0.4;

/** How far the mark's ink reaches from its centre, in cells: to the far
 *  corner of its farthest cell. */
function reach(mark: readonly string[]): number {
  const mid = mark.length / 2;
  const far = (i: number) => Math.max(mid - i, i + 1 - mid);
  let max = 0;
  mark.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === "#") max = Math.max(max, Math.hypot(far(x), far(y)));
    });
  });
  return max;
}

/** Which mark, whole pixels per cell, and where it starts. Small icons
 *  keep a pixel or more each side; larger ones keep the mark inside the
 *  maskable safe circle (192 and 512 double as maskable). Odd room splits
 *  with the extra pixel right and below. */
export function iconLayout(size: number): { mark: readonly string[]; cell: number; at: number } {
  const mark = size <= SMALL_UP_TO ? MARK_SMALL : MARK;
  const cell = Math.max(
    1,
    mark === MARK_SMALL
      ? Math.floor((size - 2) / mark.length)
      : Math.floor((SAFE_RADIUS * size) / reach(mark)),
  );
  return { mark, cell, at: Math.floor((size - cell * mark.length) / 2) };
}

/** A `size`-pixel square icon as RGBA. */
export function drawIcon(size: number): Uint8Array {
  const { mark, cell, at } = iconLayout(size);
  const ground = hexToRgb(GROUND.dark);
  const ink = hexToRgb(BRAND);
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = mark[Math.floor((y - at) / cell)];
      const on = y >= at && x >= at && row?.[Math.floor((x - at) / cell)] === "#";
      px.set([...(on ? ink : ground), 255], (y * size + x) * 4);
    }
  }
  return px;
}
