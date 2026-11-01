/**
 * Hex ↔ bytes ↔ text helpers that work in the browser (no Node `Buffer`).
 *
 * `hexToBytes` matches `Buffer.from(hex, "hex")`: it reads whole byte
 * pairs and stops at the first pair that isn't hex, so a stray odd
 * nibble or junk tail never throws.
 */

const utf8 = new TextDecoder("utf-8");

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  let n = 0;
  for (; n < out.length; n++) {
    const pair = hex.slice(n * 2, n * 2 + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) break;
    out[n] = parseInt(pair, 16);
  }
  return n === out.length ? out : out.slice(0, n);
}

/** Decode hex as UTF-8. Invalid sequences become U+FFFD, like `Buffer`. */
export function hexToUtf8(hex: string): string {
  return utf8.decode(hexToBytes(hex));
}

/** Uppercase hex of a string's char codes. For ASCII input only. */
export function asciiToHex(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += (text.charCodeAt(i) & 0xff).toString(16).padStart(2, "0");
  }
  return out.toUpperCase();
}
