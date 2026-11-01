import { describe, expect, it } from "vitest";
import { currencyCode, isLedgerCurrency, mptIssuanceId, parseTokenId, tokenId, tokenPath } from "./token-id";

const SOLO_HEX = "534F4C4F00000000000000000000000000000000";
const ISSUER = "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz";
const MPT = "0627B6859931344A3871ED63805BBF07DECBF03F9C2698BD";

describe("currencyCode", () => {
  it.each([
    ["USD", "USD"],
    [SOLO_HEX, "SOLO"],
    // "ABC" hex-encoded: printed as ABC it would map to the 3-char code instead.
    ["4142430000000000000000000000000000000000", "4142430000000000000000000000000000000000"],
    // Not printable: stays hex.
    ["03A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3", "03A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3"],
  ])("%s → %s", (currency, code) => {
    expect(currencyCode(currency)).toBe(code);
  });
});

describe("isLedgerCurrency", () => {
  it.each([
    ["USD", true],
    ["$$$", true],
    [SOLO_HEX, true],
    ["XRP", false],
    ["xrp", false],
    ["US", false],
    ["U.S", false],
    [SOLO_HEX.toLowerCase(), false],
  ])("%s → %s", (currency, ok) => {
    expect(isLedgerCurrency(currency)).toBe(ok);
  });
});

describe("token IDs", () => {
  it("round-trips an IOU through its printed code", () => {
    const ref = { kind: "iou" as const, currency: SOLO_HEX, issuer: ISSUER };
    expect(tokenId(ref)).toBe(`SOLO.${ISSUER}`);
    expect(parseTokenId(tokenId(ref))).toEqual(ref);
  });

  it("reads a hex code, upper-casing it", () => {
    expect(parseTokenId(`${SOLO_HEX.toLowerCase()}.${ISSUER}`)).toEqual({ kind: "iou", currency: SOLO_HEX, issuer: ISSUER });
  });

  it("splits at the last dot, so a code may hold one", () => {
    expect(parseTokenId(`AB.CD.${ISSUER}`)).toEqual({ kind: "iou", currency: "41422E4344000000000000000000000000000000", issuer: ISSUER });
  });

  it("reads an MPT issuance ID", () => {
    expect(parseTokenId(MPT.toLowerCase())).toEqual({ kind: "mpt", id: MPT });
    expect(tokenId({ kind: "mpt", id: MPT })).toBe(MPT);
  });

  it.each([
    ["no issuer", "SOLO"],
    ["a bad checksum", "SOLO.rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZy"],
    ["XRP", `XRP.${ISSUER}`],
    ["a code too long", `ABCDEFGHIJKLMNOPQRSTU.${ISSUER}`],
    ["an empty code", `.${ISSUER}`],
  ])("rejects %s", (_, id) => {
    expect(parseTokenId(id)).toBeNull();
  });

  it("builds an MPT's issuance ID from its issuer and sequence", () => {
    expect(mptIssuanceId(0x0627b685, "rNyrL3hjvM3mDYtTDhHLWMiGtbnV2wdBv6")).toBe(MPT);
  });

  it("escapes the code in a path", () => {
    expect(tokenPath({ kind: "iou", currency: "41422F4344000000000000000000000000000000", issuer: ISSUER })).toBe(
      `/token/AB%2FCD.${ISSUER}`,
    );
  });
});
