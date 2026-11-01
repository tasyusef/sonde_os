import type { RecentTx } from "@/types/live-data";
import type { TxResponse } from "@/types/xrpl-responses";
import { deliveredDrops } from "./xrpl-helpers";

/** `ledger` reply (API v1) with `transactions: true, expand: true`. */
export interface ExpandedLedger {
  /** API v1 returns this as a string. */
  ledger_index: number | string;
  ledger_hash: string;
  close_time: number;
  parent_hash: string;
  total_coins: string;
  transactions?: TxResponse[];
}

export type LedgerRef = { ledger_index: number } | { ledger_hash: string };

/** `/ledger/<ref>`: digits are an index, 64 hex chars a ledger hash.
 *  Null for anything else, including a malformed `%` escape. */
export function parseLedgerRef(param: string): LedgerRef | null {
  let ref: string;
  try {
    ref = decodeURIComponent(param).trim();
  } catch {
    return null;
  }
  if (/^\d{1,10}$/.test(ref)) {
    const index = Number(ref);
    return index >= 1 && index <= 0xffffffff ? { ledger_index: index } : null;
  }
  if (/^[A-Fa-f0-9]{64}$/.test(ref)) return { ledger_hash: ref.toUpperCase() };
  return null;
}

/** Explorer rows for an expanded ledger, in execution order. */
export function ledgerTxRows(ledger: ExpandedLedger): RecentTx[] {
  const ledgerIndex = Number(ledger.ledger_index);
  return [...(ledger.transactions ?? [])]
    .map((tx) => ({ tx, meta: tx.meta ?? tx.metaData }))
    .sort((a, b) => (a.meta?.TransactionIndex ?? 0) - (b.meta?.TransactionIndex ?? 0))
    .map(({ tx, meta }) => ({
      hash: tx.hash,
      type: tx.TransactionType,
      account: tx.Account,
      destination: tx.Destination,
      amount: deliveredDrops(tx, meta),
      fee: tx.Fee,
      result: meta?.TransactionResult ?? "",
      // Txs inside a ledger carry no date of their own.
      date: tx.date ?? ledger.close_time,
      ledgerIndex,
    }));
}
