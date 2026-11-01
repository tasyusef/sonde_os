import { describe, expect, it } from "vitest";
import { ledgerTxRows, parseLedgerRef, type ExpandedLedger } from "./ledger-txs";

const HASH = "F8743B4B1C9635F9AF403BEDAF892CFA0CF0FF2F6E3D4A35FF54353E4AE2E626";

describe("parseLedgerRef", () => {
  it("reads an index or a ledger hash", () => {
    expect(parseLedgerRef("107969812")).toEqual({ ledger_index: 107969812 });
    expect(parseLedgerRef(HASH.toLowerCase())).toEqual({ ledger_hash: HASH });
  });

  it("rejects everything else", () => {
    for (const bad of ["0", "-1", "abc", "12.5", "99999999999", HASH.slice(1), "", "%", "12%E0%A4%A"]) {
      expect(parseLedgerRef(bad)).toBeNull();
    }
  });
});

describe("ledgerTxRows", () => {
  const ledger: ExpandedLedger = {
    ledger_index: "100",
    ledger_hash: HASH,
    close_time: 800000000,
    parent_hash: HASH,
    total_coins: "99986000000000000",
    transactions: [
      {
        hash: "B",
        TransactionType: "OfferCreate",
        Account: "rB",
        Fee: "12",
        metaData: { TransactionResult: "tecKILLED", TransactionIndex: 1 },
      },
      {
        hash: "A",
        TransactionType: "Payment",
        Account: "rA",
        Destination: "rD",
        Amount: "5000000",
        Fee: "10",
        metaData: { TransactionResult: "tesSUCCESS", delivered_amount: "4000000", TransactionIndex: 0 },
      },
    ],
  };

  it("maps rows in execution order with the ledger's close time", () => {
    expect(ledgerTxRows(ledger)).toEqual([
      {
        hash: "A",
        type: "Payment",
        account: "rA",
        destination: "rD",
        amount: "4000000",
        fee: "10",
        result: "tesSUCCESS",
        date: 800000000,
        ledgerIndex: 100,
      },
      {
        hash: "B",
        type: "OfferCreate",
        account: "rB",
        destination: undefined,
        amount: undefined,
        fee: "12",
        result: "tecKILLED",
        date: 800000000,
        ledgerIndex: 100,
      },
    ]);
  });

  it("handles a ledger with no transactions", () => {
    expect(ledgerTxRows({ ...ledger, transactions: undefined })).toEqual([]);
  });
});
