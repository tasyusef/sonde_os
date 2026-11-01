import { describe, expect, it } from "vitest";
import { findBurn, nftHistoryRows } from "./nft-history";

const ACCOUNT = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";

describe("nftHistoryRows", () => {
  it("maps entries and keeps their order", () => {
    const rows = nftHistoryRows([
      {
        tx: { hash: "B", TransactionType: "NFTokenBurn", Account: ACCOUNT, date: 20, ledger_index: 2 },
        meta: { TransactionResult: "tesSUCCESS" },
      },
      {
        hash: "A",
        tx: {
          TransactionType: "NFTokenAcceptOffer",
          Account: ACCOUNT,
          Amount: { value: "5", currency: "USD", issuer: ACCOUNT },
        },
      },
    ]);
    expect(rows).toEqual([
      { hash: "B", type: "NFTokenBurn", account: ACCOUNT, date: 20, ledger_index: 2, result: "tesSUCCESS", amount: undefined },
      {
        hash: "A",
        type: "NFTokenAcceptOffer",
        account: ACCOUNT,
        date: undefined,
        ledger_index: undefined,
        result: "unknown",
        amount: { value: "5", currency: "USD", issuer: ACCOUNT },
      },
    ]);
  });

  it("drops incomplete entries", () => {
    expect(
      nftHistoryRows([{ tx: { TransactionType: "NFTokenMint", Account: ACCOUNT } }, { hash: "C", tx: { Account: ACCOUNT } }, {}]),
    ).toEqual([]);
  });
});

describe("findBurn", () => {
  it("finds only a successful burn", () => {
    const base = { hash: "H", account: ACCOUNT };
    expect(findBurn([{ ...base, type: "NFTokenBurn", result: "tecNO_PERMISSION" }])).toBeUndefined();
    expect(findBurn([{ ...base, type: "NFTokenBurn", result: "tesSUCCESS" }])?.hash).toBe("H");
  });
});
