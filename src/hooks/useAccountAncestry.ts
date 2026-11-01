/**
 * useAccountAncestry — who activated the account, and when: the first
 * `account_tx` entry (`forward: true, limit: 1`), read as the
 * activating Payment when it is one. A failed lookup is an error, not
 * "no ancestry", so it isn't cached as an answer.
 */

import type { SendFn } from "@/lib/xrpl-pagination";
import { deliveredDrops } from "@/lib/xrpl-helpers";
import type { AccountTxResult } from "@/types/xrpl";
import { useXrplQuery } from "./useXrplQuery";

export interface AncestryData {
  parentAddress: string | null;
  activationDate: number | null;
  fundingAmount: string | null;
  activationHash: string | null;
  activationLedgerIndex: number | null;
  activationTxIndex: number | null;
}

const EMPTY_ANCESTRY: AncestryData = {
  parentAddress: null,
  activationDate: null,
  fundingAmount: null,
  activationHash: null,
  activationLedgerIndex: null,
  activationTxIndex: null,
};

async function fetchAncestryFromRippled(
  address: string,
  send: SendFn,
): Promise<AncestryData> {
  const result = (await send({
    command: "account_tx",
    account: address,
    ledger_index_min: -1,
    ledger_index_max: -1,
    forward: true,
    limit: 1,
  })) as AccountTxResult;
  const firstTxs = result.transactions ?? [];
  if (firstTxs.length === 0) return EMPTY_ANCESTRY;
  const tx = firstTxs[0].tx;
  const isInboundPayment =
    tx.TransactionType === "Payment" && tx.Destination === address;
  return {
    parentAddress: isInboundPayment ? ((tx.Account as string) ?? null) : null,
    activationDate: (tx.date as number) ?? null,
    fundingAmount: isInboundPayment
      ? (deliveredDrops(tx, firstTxs[0].meta) ?? null)
      : null,
    activationHash: (tx.hash as string) ?? null,
    activationLedgerIndex: (tx.ledger_index as number) ?? null,
    activationTxIndex:
      typeof tx.TransactionIndex === "number"
        ? tx.TransactionIndex
        : typeof (firstTxs[0].meta as Record<string, unknown>)
              ?.TransactionIndex === "number"
          ? ((firstTxs[0].meta as Record<string, unknown>)
              .TransactionIndex as number)
          : null,
  };
}

export function useAccountAncestry(address: string) {
  // Activation never changes: fetched once per address.
  const { data, error, isLoading, retry } = useXrplQuery<AncestryData>(
    address ? ["account-ancestry", address] : null,
    ({ send }) => fetchAncestryFromRippled(address, send),
    { errorRetryCount: 1 },
  );

  return {
    ancestry: data ?? EMPTY_ANCESTRY,
    isLoading,
    /** The lookup failed and there's nothing to show. */
    failed: !data && !!error && !isLoading,
    retry,
  };
}
