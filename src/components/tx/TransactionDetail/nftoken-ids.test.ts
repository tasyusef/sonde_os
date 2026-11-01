import { describe, expect, it } from "vitest";
import { findNftokenIds } from "./nftoken-ids";

const A = "000813881B2A6E50A4E9FE5A6C6D5C8A4F7E0D1C2B3A49586776655443322110";
const B = `00081388${"AB".repeat(24)}00000002`;

describe("findNftokenIds", () => {
  it("reads NFTokenID from the tx body", () => {
    expect(findNftokenIds({ TransactionType: "NFTokenCreateOffer", NFTokenID: A })).toEqual([A]);
  });

  it("reads meta.nftoken_id and meta.nftoken_ids", () => {
    expect(
      findNftokenIds({ TransactionType: "NFTokenMint", meta: { nftoken_id: A } }),
    ).toEqual([A]);
    expect(
      findNftokenIds({ TransactionType: "NFTokenCancelOffer", meta: { nftoken_ids: [A, B] } }),
    ).toEqual([A, B]);
  });

  it("falls back to NFTokenOffer nodes in AffectedNodes", () => {
    const tx = {
      TransactionType: "NFTokenAcceptOffer",
      metaData: {
        AffectedNodes: [
          { ModifiedNode: { LedgerEntryType: "AccountRoot", FinalFields: {} } },
          { DeletedNode: { LedgerEntryType: "NFTokenOffer", FinalFields: { NFTokenID: B } } },
          { CreatedNode: { LedgerEntryType: "NFTokenOffer", NewFields: { NFTokenID: A } } },
        ],
      },
    };
    expect(findNftokenIds(tx)).toEqual([B, A]);
  });

  it("dedupes case-insensitively and drops malformed IDs", () => {
    const tx = {
      TransactionType: "NFTokenAcceptOffer",
      NFTokenID: A.toLowerCase(),
      meta: { nftoken_id: A, nftoken_ids: ["nope", 42, B] },
    };
    expect(findNftokenIds(tx)).toEqual([A, B]);
  });

  it("returns [] when nothing identifies a token", () => {
    expect(findNftokenIds({ TransactionType: "NFTokenAcceptOffer" })).toEqual([]);
  });
});
