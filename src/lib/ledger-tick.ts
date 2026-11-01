import { XRPL_EPOCH } from "./xrpl-helpers";

/** The latest validated ledger, from the main socket's ledger stream. */
export interface LedgerTick {
  index: number;
  /** Unix ms. */
  closedAt: number;
  /** Absent from the subscribe response; the first stream message fills it. */
  txCount: number | null;
}

/** Reads a `ledgerClosed` stream message or a `subscribe` result. */
export function parseLedgerTick(data: Record<string, unknown>): LedgerTick | null {
  if (data.type !== undefined && data.type !== "ledgerClosed") return null;
  const { ledger_index: index, ledger_time: time, txn_count: txCount } = data;
  if (typeof index !== "number" || typeof time !== "number") return null;
  return {
    index,
    closedAt: (time + XRPL_EPOCH) * 1000,
    txCount: typeof txCount === "number" ? txCount : null,
  };
}

/** A one-value store for `useSyncExternalStore`, so a tick re-renders
 *  only the components that read it, not every `useXrpl()` consumer. */
export function createLedgerTickStore() {
  let tick: LedgerTick | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => tick,
    set(next: LedgerTick) {
      // A reconnect re-sends the subscribe result for a ledger we've seen.
      if (tick && next.index < tick.index) return;
      if (tick && next.index === tick.index && next.txCount === null) return;
      tick = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type LedgerTickStore = ReturnType<typeof createLedgerTickStore>;
