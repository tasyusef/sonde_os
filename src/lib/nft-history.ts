import type { NFTHistoryTransaction } from "@/types/nft";
import type { NFTHistoryResponse } from "@/types/xrpl-responses";

export type NftHistoryEntry = NonNullable<NFTHistoryResponse["transactions"]>[number];

/** `nft_history` (Clio) entries → table rows, newest first as Clio
 *  returns them. Entries without a type, account or hash are dropped. */
export function nftHistoryRows(entries: readonly NftHistoryEntry[]): NFTHistoryTransaction[] {
  const rows: NFTHistoryTransaction[] = [];
  for (const entry of entries) {
    const tx = entry.tx;
    const hash = tx?.hash ?? entry.hash;
    if (!tx?.TransactionType || !tx.Account || !hash) continue;
    const amount = tx.Amount;
    rows.push({
      hash,
      type: tx.TransactionType,
      account: tx.Account,
      date: tx.date,
      ledger_index: tx.ledger_index,
      result: entry.meta?.TransactionResult ?? "unknown",
      amount:
        amount === undefined || typeof amount === "string"
          ? amount
          : { value: amount.value, currency: amount.currency, issuer: amount.issuer },
    });
  }
  return rows;
}

/** The successful burn, if the NFT was burned. */
export function findBurn(rows: readonly NFTHistoryTransaction[]): NFTHistoryTransaction | undefined {
  return rows.find((tx) => tx.type === "NFTokenBurn" && tx.result === "tesSUCCESS");
}
