/** Shared types for the live snapshot the relay sends (built by `relay/src/snapshot.rs`). */

/** Minimal per-transaction summary for visual dot grids (ledger cards). */
export interface TxSummary {
  hash: string;
  type: string;
  result: string;
}

export interface LedgerEvent {
  ledger_index: number;
  ledger_hash: string;
  ledger_time: number;
  txn_count: number;
  /** Per-tx summaries for the visual dot grid. Populated by the SSE pipeline. */
  txSummaries?: TxSummary[];
  /** Total fees burned in this ledger (in drops). */
  totalFees?: string;
}

export interface RecentTx {
  hash: string;
  type: string;
  account: string;
  destination?: string;
  amount?: string;
  fee: string;
  result: string;
  date?: number;
  ledgerIndex?: number;
}

export interface NetworkStats {
  ledgerIndex: number;
  txCount: number;
  closeTime: number;
  totalCoins: string;
  baseFee: string;
  reserveBase: number;
  reserveIncrement: number;
}

export interface PriceData {
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  circulatingSupply: number;
  totalSupply: number;
}
