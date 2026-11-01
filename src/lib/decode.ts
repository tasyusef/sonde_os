// The Decode effect, as frames: a text's letters and digits cycle through
// a glyph pool and settle left to right. Punctuation and spaces hold their
// place, so a truncated hash or a grouped number keeps its shape. Ported
// from Tim's portfolio (`Decode.svelte`); the component side lives in
// `components/shared/Decode`.

/** What an unsettled character shows. Departure Mono draws every one a
 *  cell wide, so the line never shifts while it settles. */
export const POOL = "#%@*+=-:/\\|<>01";

const SCRAMBLES = /[\p{L}\p{N}]/u;

/** A deterministic PRNG in [0, 1): a seed always draws the same run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from the text (FNV-1a), so a hash scrambles the same way for
 *  everyone, every time. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Characters settled on `frame` of `frames`: spread evenly, so a long
 *  hash settles in the same time as a short address. */
export function settledAt(length: number, frame: number, frames: number): number {
  if (frames <= 0) return length;
  return Math.min(length, Math.ceil((length * Math.max(0, frame)) / frames));
}

/** The text as it shows on `frame` of `frames`: settled up to
 *  `settledAt`, and after that every letter and digit drawn from the pool,
 *  fresh each frame. Pure, so a render can call it. */
export function decodeFrame(text: string, frame: number, frames: number, seed: number): string {
  const chars = [...text];
  const settled = settledAt(chars.length, frame, frames);
  const rnd = mulberry32(seed + frame * 7919);
  return chars
    .map((c, k) =>
      k < settled || !SCRAMBLES.test(c) ? c : POOL[Math.floor(rnd() * POOL.length)],
    )
    .join("");
}
