// Hashing and ordered dither for drawn textures: a given seed always draws
// the same field. Ported from Tim's portfolio (`src/lib/prng.ts`).

/** Integer lattice hash in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 8×8 Bayer ordered-dither matrix, values 0–63. */
export const BAYER8: readonly (readonly number[])[] = (() => {
  let cur = [
    [0, 2],
    [3, 1],
  ];
  for (let s = 2; s < 8; s *= 2) {
    const next: number[][] = [];
    for (let y = 0; y < s * 2; y++) {
      next.push([]);
      for (let x = 0; x < s * 2; x++) {
        const q = (y >= s ? 2 : 0) + (x >= s ? 1 : 0);
        next[y][x] = cur[y % s][x % s] * 4 + [0, 2, 3, 1][q];
      }
    }
    cur = next;
  }
  return cur;
})();

/** Whether a cell survives at `weight` (0–1) under ordered dither: more
 *  weight keeps more cells, in a fixed pattern rather than at random. */
export function dithered(x: number, y: number, weight: number): boolean {
  return weight * 64 > BAYER8[y & 7][x & 7];
}

/** `dithered` on the 4×4 matrix: 16 steps, a bolder pattern that
 *  repeats every four cells. (The 8×8's corner, quartered, is the 4×4.) */
export function dithered4(x: number, y: number, weight: number): boolean {
  return weight * 16 > BAYER8[y & 3][x & 3] >> 2;
}
