import type { LedgerEvent, NetworkStats, PriceData } from "@/types/live-data";
import type { ServerHealth } from "@/types/network";

/** 201 events = 200 intervals for the heatmap grid. */
export const MAX_LEDGER_HISTORY = 201;

export interface LiveData {
  ledger: LedgerEvent | null;
  /** Rolling history of recent ledger events (newest last). */
  ledgerHistory: LedgerEvent[];
  stats: NetworkStats | null;
  health: ServerHealth | null;
  price: PriceData | null;
  connected: boolean;
}

export const initialLiveData: LiveData = {
  ledger: null,
  ledgerHistory: [],
  stats: null,
  health: null,
  price: null,
  connected: false,
};

/** One message from the live relay (`relay/src/snapshot.rs`). `health` and
 *  `price` are absent until the relay knows them. It also sends an empty
 *  `transactions` for sites built before 9724a5ce; nothing here reads it. */
export interface RelaySnapshot {
  ledger: LedgerEvent;
  stats: NetworkStats;
  health?: ServerHealth;
  price?: PriceData;
}

/** Folds a relay snapshot into the live state, with the same rules as the SSE
 *  events: absent slices keep their last value, and a repeated ledger doesn't
 *  grow the history. */
export function applySnapshot(prev: LiveData, snapshot: RelaySnapshot): LiveData {
  const repeat = prev.ledger?.ledger_index === snapshot.ledger.ledger_index;
  return {
    ...prev,
    ledger: repeat ? prev.ledger : snapshot.ledger,
    ledgerHistory: repeat
      ? prev.ledgerHistory
      : [...prev.ledgerHistory, snapshot.ledger].slice(-MAX_LEDGER_HISTORY),
    stats: snapshot.stats,
    health: snapshot.health ?? prev.health,
    price: snapshot.price ?? prev.price,
  };
}
