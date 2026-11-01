import { describe, expect, it, vi } from "vitest";
import { createLedgerTickStore, parseLedgerTick } from "./ledger-tick";
import { XRPL_EPOCH } from "./xrpl-helpers";

describe("parseLedgerTick", () => {
  it("reads a ledgerClosed stream message", () => {
    expect(
      parseLedgerTick({ type: "ledgerClosed", ledger_index: 100, ledger_time: 10, txn_count: 42 }),
    ).toEqual({ index: 100, closedAt: (10 + XRPL_EPOCH) * 1000, txCount: 42 });
  });

  it("reads a subscribe result, which has no tx count", () => {
    expect(parseLedgerTick({ ledger_index: 100, ledger_time: 10, fee_base: 10 })).toEqual({
      index: 100,
      closedAt: (10 + XRPL_EPOCH) * 1000,
      txCount: null,
    });
  });

  it("ignores other streams and malformed messages", () => {
    expect(parseLedgerTick({ type: "transaction", ledger_index: 100, ledger_time: 10 })).toBeNull();
    expect(parseLedgerTick({ type: "ledgerClosed", ledger_index: "100", ledger_time: 10 })).toBeNull();
    expect(parseLedgerTick({})).toBeNull();
  });
});

describe("createLedgerTickStore", () => {
  const tick = (index: number, txCount: number | null = 1) => ({ index, closedAt: 0, txCount });

  it("notifies on a newer ledger", () => {
    const store = createLedgerTickStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(tick(1));
    store.set(tick(2));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get()?.index).toBe(2);
  });

  it("keeps the newest ledger when a reconnect replays an older one", () => {
    const store = createLedgerTickStore();
    store.set(tick(5, 30));
    store.set(tick(4));
    store.set(tick(5, null));
    expect(store.get()).toEqual(tick(5, 30));
  });

  it("stops notifying after unsubscribe", () => {
    const store = createLedgerTickStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(tick(1));
    expect(listener).not.toHaveBeenCalled();
  });
});
