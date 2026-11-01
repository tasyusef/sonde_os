import { describe, expect, it } from "vitest";
import { decodeAccountID } from "ripple-address-codec";
import { nftInfoFromId, parseNFTokenID } from "./nft-utils";

const ISSUER = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0").toUpperCase();
}

/** Build an NFTokenID the way rippled does (scrambled taxon). */
function buildId(flags: number, fee: number, taxon: number, serial: number): string {
  const issuerHex = Array.from(decodeAccountID(ISSUER), (b) => hex(b, 2)).join("");
  const scramble = Number((384160001n * BigInt(serial) + 2459n) & 0xffffffffn);
  return hex(flags, 4) + hex(fee, 4) + issuerHex + hex((taxon ^ scramble) >>> 0, 8) + hex(serial, 8);
}

describe("parseNFTokenID", () => {
  it("decodes flags, fee, issuer, taxon and serial", () => {
    const id = buildId(0x000b, 314, 42, 3429);
    expect(parseNFTokenID(id)).toEqual({
      flags: 0x000b,
      transfer_fee: 314,
      issuer: ISSUER,
      nft_taxon: 42,
      nft_serial: 3429,
    });
  });

  it("handles a serial near the 32-bit limit", () => {
    const id = buildId(8, 0, 0xfffffffe, 0xffffffff);
    expect(parseNFTokenID(id)).toMatchObject({ nft_taxon: 0xfffffffe, nft_serial: 0xffffffff });
  });

  it("rejects anything but 64 hex chars", () => {
    expect(parseNFTokenID("abc")).toBeNull();
    expect(parseNFTokenID("Z".repeat(64))).toBeNull();
  });
});

describe("nftInfoFromId", () => {
  it("fills the static fields and leaves the rest unknown", () => {
    const id = buildId(8, 500, 7, 12).toLowerCase();
    expect(nftInfoFromId(id)).toEqual({
      nft_id: id.toUpperCase(),
      owner: "",
      is_burned: false,
      uri: null,
      flags: 8,
      transfer_fee: 500,
      issuer: ISSUER,
      nft_taxon: 7,
      nft_serial: 12,
    });
    expect(nftInfoFromId("nope")).toBeNull();
  });
});
