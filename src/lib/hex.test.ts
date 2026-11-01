import { describe, expect, it } from "vitest";
import { asciiToHex, hexToBytes, hexToUtf8 } from "./hex";

describe("hexToBytes", () => {
  it("decodes upper and lower case", () => {
    expect([...hexToBytes("00ff7Fa0")]).toEqual([0, 255, 127, 160]);
  });

  it("ignores a trailing odd nibble", () => {
    expect([...hexToBytes("4142F")]).toEqual([0x41, 0x42]);
  });

  it("stops at the first pair that isn't hex", () => {
    expect([...hexToBytes("4142zz43")]).toEqual([0x41, 0x42]);
    expect([...hexToBytes("zz")]).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(hexToBytes("").length).toBe(0);
  });
});

describe("hexToUtf8", () => {
  it("decodes an IPFS URI", () => {
    const hex = asciiToHex("ipfs://bafy/1.json");
    expect(hexToUtf8(hex)).toBe("ipfs://bafy/1.json");
  });

  it("decodes multi-byte UTF-8", () => {
    expect(hexToUtf8("e282ac")).toBe("€");
  });

  it("replaces invalid sequences instead of throwing", () => {
    expect(hexToUtf8("ff41")).toBe("�A");
  });
});

describe("asciiToHex", () => {
  it("encodes ASCII as uppercase hex", () => {
    expect(asciiToHex("ARMY")).toBe("41524D59");
    expect(asciiToHex("")).toBe("");
  });
});
