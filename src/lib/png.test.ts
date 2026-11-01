import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeIco, encodePng } from "./png";

/** The chunks of a PNG, with their CRCs checked. */
function chunks(png: Buffer) {
  const out: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    out.push({ type, data });
    at += 12 + length;
  }
  return out;
}

describe("encodePng", () => {
  const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const png = encodePng(3, 2, rgba);

  it("writes the signature, then IHDR, IDAT and IEND", () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(chunks(png).map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("describes 8-bit RGBA at the given size", () => {
    const ihdr = chunks(png)[0].data;
    expect([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8], ihdr[9]]).toEqual([3, 2, 8, 6]);
  });

  it("stores each row unfiltered", () => {
    const raw = inflateSync(chunks(png)[1].data);
    expect([...raw]).toEqual([0, ...rgba.subarray(0, 12), 0, ...rgba.subarray(12)]);
  });

  it("refuses pixels that don't fit the size", () => {
    expect(() => encodePng(2, 2, rgba)).toThrow();
  });
});

describe("encodeIco", () => {
  it("lists each PNG with its size and where it starts", () => {
    const a = encodePng(1, 1, new Uint8Array(4));
    const b = encodePng(2, 2, new Uint8Array(16));
    const ico = encodeIco([
      { size: 16, png: a },
      { size: 256, png: b },
    ]);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 2]);
    expect([ico[6], ico[7], ico.readUInt32LE(14), ico.readUInt32LE(18)]).toEqual([16, 16, a.length, 38]);
    expect([ico[22], ico.readUInt32LE(34)]).toEqual([0, 38 + a.length]);
    expect(ico.subarray(38 + a.length).equals(b)).toBe(true);
  });
});
