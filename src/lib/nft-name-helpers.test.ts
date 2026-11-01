import { describe, expect, it } from "vitest";
import { extractCollectionName, pickCollectionName } from "./nft-name-helpers";

describe("extractCollectionName", () => {
  it("strips a trailing token number", () => {
    expect(extractCollectionName("Rowboat #12")).toBe("Rowboat");
    expect(extractCollectionName("Rowboat - 12")).toBe("Rowboat");
    expect(extractCollectionName("Plain")).toBe("Plain");
  });
});

describe("pickCollectionName", () => {
  it("needs a strict majority across samples", () => {
    expect(pickCollectionName(["Ape #1", "Ape #2", "Cat #3"])).toBe("Ape");
    expect(pickCollectionName(["Ape #1", "Cat #2"])).toBeNull();
  });

  it("trusts a single sample only when it stripped a number", () => {
    expect(pickCollectionName(["Ape #1"])).toBe("Ape");
    expect(pickCollectionName(["894"])).toBeNull();
    expect(pickCollectionName([null, undefined])).toBeNull();
  });
});
