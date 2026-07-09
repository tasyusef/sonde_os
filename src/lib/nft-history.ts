import { xrplClient } from "@/lib/xrpl-client";
import { singleflight, nftHistoryDataCache } from "@/lib/cache";
import type { NFTHistoryTransaction } from "@/types/nft";
import type { NFTHistoryResponse } from "@/types/xrpl-responses";

type HistoryTx = NonNullable<NFTHistoryResponse["transactions"]>[number];

function extractAmount(
  tx: HistoryTx["tx"]
): NFTHistoryTransaction["amount"] | undefined {
  if (!tx?.Amount) return undefined;
  if (typeof tx.Amount === "string") return tx.Amount;
  return {
    value: tx.Amount.value,
    currency: tx.Amount.currency,
    issuer: tx.Amount.issuer,
  };
}

async function fetchNFTHistoryUncached(
  nftId: string,
): Promise<NFTHistoryTransaction[]> {
  const transactions: NFTHistoryTransaction[] = [];
  let marker: unknown = undefined;
  const maxPages = 4;

  for (let page = 0; page < maxPages; page++) {
    const result = await xrplClient.getNFTHistory(nftId, marker);
    if (!result?.transactions) break;

    for (const entry of result.transactions) {
      const tx = entry.tx;
      if (!tx?.TransactionType || !tx?.Account) continue;
      const hash = tx.hash ?? entry.hash;
      if (!hash) continue;

      transactions.push({
        hash,
        type: tx.TransactionType,
        account: tx.Account,
        date: tx.date,
        ledger_index: tx.ledger_index,
        result: entry.meta?.TransactionResult ?? "unknown",
        amount: extractAmount(tx),
      });
    }

    marker = result.marker;
    if (!marker) break;
  }

  return transactions;
}

/** Fetch paginated nft_history and normalize into NFTHistoryTransaction[].
 *  Deduped + cached via singleflight — multiple callers for the same nftId
 *  in the same render share one underlying network request. */
export function getNFTHistory(
  nftId: string,
): Promise<NFTHistoryTransaction[]> {
  return singleflight(
    `nft-history:${nftId}`,
    nftHistoryDataCache,
    () => fetchNFTHistoryUncached(nftId),
  );
}
