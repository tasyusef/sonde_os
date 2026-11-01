// OKLCH to sRGB, for the places that need a token as numbers: the
// contrast tests, and the icons `scripts/brand.ts` draws.

/** sRGB's transfer, extended past 0-1 as CSS Color 4 does, so a P3
 *  colour outside sRGB keeps its luminance. */
const encode = (v: number) =>
  Math.sign(v) * (Math.abs(v) <= 0.0031308 ? 12.92 * Math.abs(v) : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055);

/** OKLCH as sRGB channels, 0-255 (past either end for a P3 colour). */
export function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ].map((v) => encode(v) * 255) as [number, number, number];
}

/** An opaque `oklch(L C H)` token as `#RRGGBB`, clipped to sRGB. */
export function oklchToHex(value: string): string {
  const m = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (!m) throw new Error(`not an opaque oklch() colour: ${value}`);
  const rgb = oklchToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** `#RRGGBB` as channels, 0-255. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
