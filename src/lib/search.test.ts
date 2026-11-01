import { describe, expect, it } from "vitest";
import { hitPath, looksLikeAddress, parseSearch } from "./search";

const ADDRESS = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const HASH = "E3FE6EA3D48F0C2B639448020EA4F03D4F4F8FFDB243A852A0F59177921B4879";

describe("parseSearch", () => {
  it("reads each shape", () => {
    expect(parseSearch(ADDRESS)).toEqual({ kind: "account", id: ADDRESS });
    expect(parseSearch("107964754")).toEqual({ kind: "ledger", id: "107964754" });
    expect(parseSearch(HASH)).toEqual({ kind: null, id: HASH });
  });

  it("rejects an address with a typo, which fails its checksum", () => {
    const typo = ADDRESS.replace("PEPPER", "PEPPEB");
    expect(looksLikeAddress(typo)).toBe(true);
    expect(parseSearch(typo)).toBeNull();
  });

  it("upper-cases a 64-hex ID, which only the ledger can place", () => {
    expect(parseSearch(HASH.toLowerCase())).toEqual({ kind: null, id: HASH });
  });

  it("reads an all-digit 64-char string as an ID, not a ledger index", () => {
    expect(parseSearch("1".repeat(64))).toEqual({ kind: null, id: "1".repeat(64) });
  });

  it("reads a ledger number grouped the way pages print it", () => {
    for (const grouped of ["107,964,754", "107.964.754", "107 964 754", "107 964 754", "1,000"]) {
      expect(parseSearch(grouped)).toEqual({ kind: "ledger", id: grouped.replace(/\D/g, "") });
    }
  });

  it("rejects malformed grouping", () => {
    for (const bad of ["1,2,3", "1234,567", "107,964.754", "107,96", ",107", "1.5"]) {
      expect(parseSearch(bad)).toBeNull();
    }
  });

  it("trims whitespace first", () => {
    expect(parseSearch(`  ${ADDRESS}\n`)?.kind).toBe("account");
    expect(parseSearch(`\t${HASH} `)?.id).toBe(HASH);
    expect(parseSearch(" 42 ")?.id).toBe("42");
  });

  it("reads a token by its ID, MPT or code and issuer", () => {
    const mpt = "0627B6859931344A3871ED63805BBF07DECBF03F9C2698BD";
    expect(parseSearch(mpt.toLowerCase())).toEqual({ kind: "token", id: mpt });
    expect(parseSearch(`USD.${ADDRESS}`)).toEqual({ kind: "token", id: `USD.${ADDRESS}` });
    expect(parseSearch(`SOLO  ${ADDRESS}`)).toEqual({ kind: "token", id: `SOLO.${ADDRESS}` });
    // A hex code reads back as the ticker it spells.
    expect(parseSearch(`534f4c4f00000000000000000000000000000000.${ADDRESS}`)).toEqual({ kind: "token", id: `SOLO.${ADDRESS}` });
  });

  it("returns null for empty, partial or unknown input, which is text to look up", () => {
    for (const bad of ["", "   ", "rPEP", HASH.slice(0, 63), "1234abcd", "hello", `USD:${ADDRESS}`, `XRP.${ADDRESS}`]) {
      expect(parseSearch(bad)).toBeNull();
    }
  });
});

describe("hitPath", () => {
  it("opens each kind's page", () => {
    expect(hitPath({ kind: "account", id: ADDRESS })).toBe(`/account/${ADDRESS}`);
    expect(hitPath({ kind: "transaction", id: HASH })).toBe(`/tx/${HASH}`);
    expect(hitPath({ kind: "ledger", id: "42" })).toBe("/ledger/42");
    expect(hitPath({ kind: "nft", id: HASH })).toBe(`/nft/${HASH}`);
    expect(hitPath({ kind: "token", id: `A/B.${ADDRESS}` })).toBe(`/token/A%2FB.${ADDRESS}`);
  });
});
