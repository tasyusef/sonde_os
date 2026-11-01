import { describe, expect, it } from "vitest";
import { MAX_LEDGER_HISTORY, applySnapshot, initialLiveData, type RelaySnapshot } from "./live-snapshot";
import type { ServerHealth } from "@/types/network";

const health: ServerHealth = {
  buildVersion: "3.4.1",
  loadFactor: 1,
  serverState: "full",
  quorum: 28,
  completeLedgers: "32570-107885643",
  validatedSeq: 107885643,
};

function snapshot(index: number, overrides: Partial<RelaySnapshot> = {}): RelaySnapshot {
  return {
    ledger: {
      ledger_index: index,
      ledger_hash: `H${index}`,
      ledger_time: index,
      txn_count: 2,
      txSummaries: [
        { hash: "a", type: "Payment", result: "tesSUCCESS" },
        { hash: "b", type: "OfferCreate", result: "tesSUCCESS" },
      ],
      totalFees: "24",
    },
    stats: {
      ledgerIndex: index,
      txCount: 2,
      closeTime: index,
      totalCoins: "1",
      baseFee: "0.00001",
      reserveBase: 1,
      reserveIncrement: 0.2,
    },
    ...overrides,
  };
}

describe("applySnapshot", () => {
  it("fills every slice from a full snapshot", () => {
    const next = applySnapshot(initialLiveData, snapshot(10, { health }));
    expect(next.ledger?.ledger_index).toBe(10);
    expect(next.ledgerHistory).toHaveLength(1);
    expect(next.health).toEqual(health);
  });

  it("keeps the last health and price when a snapshot leaves them out", () => {
    const first = applySnapshot(initialLiveData, snapshot(10, { health }));
    expect(applySnapshot(first, snapshot(11)).health).toEqual(health);
  });

  it("doesn't grow the history for a repeated ledger", () => {
    const once = applySnapshot(initialLiveData, snapshot(10));
    const twice = applySnapshot(once, snapshot(10));
    expect(twice.ledgerHistory).toHaveLength(1);
    expect(twice.ledger).toBe(once.ledger);
  });

  it("caps the history", () => {
    let state = initialLiveData;
    for (let i = 1; i <= MAX_LEDGER_HISTORY + 5; i++) state = applySnapshot(state, snapshot(i));
    expect(state.ledgerHistory).toHaveLength(MAX_LEDGER_HISTORY);
    expect(state.ledgerHistory.at(-1)?.ledger_index).toBe(MAX_LEDGER_HISTORY + 5);
  });
});
