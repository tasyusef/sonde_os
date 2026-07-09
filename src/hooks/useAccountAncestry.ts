"use client";

/**
 * useAccountAncestry — server-rendered ancestry first, rippled fallback.
 *
 * The account page server-fetches ancestry from CH's `value_transfer_events`
 * (filtered to `transfer_kind = 'payment'`, ordered by inbound destination).
 * When that's available it's threaded in via `initialAncestry` and we skip
 * the rippled call entirely. When it's not (CH unreachable, activation
 * predates the backfill window, or no row indexed for the address), we
 * fall back to `account_tx forward:true limit:1` — a single cheap WS
 * round-trip — and synthesize the AncestryData from the first inbound
 * Payment.
 *
 * Part of the per-tab data-ownership refactor (Tier 2). Used by ProfileTab.
 */

import useSWR from "swr";
import { useEffect, useRef } from "react";
import { useXrpl } from "./useXrplWs";
import type { SendFn } from "@/lib/xrpl-pagination";
import type { AccountTxResult } from "@/types/xrpl";
import type { AncestryData } from "./useAccountData";

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
  try {
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
      fundingAmount:
        isInboundPayment && typeof tx.Amount === "string" ? tx.Amount : null,
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
  } catch {
    return EMPTY_ANCESTRY;
  }
}

export function useAccountAncestry(
  address: string,
  initialAncestry?: AncestryData | null,
) {
  const { send, connected } = useXrpl();
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Server-rendered ancestry is ground truth — skip the WS call when present.
  const shouldFetch = !initialAncestry && connected;

  const { data, error, isLoading } = useSWR(
    shouldFetch ? `account-ancestry:${address}` : null,
    () => fetchAncestryFromRippled(address, sendRef.current),
    {
      dedupingInterval: 60_000,
      keepPreviousData: true,
      errorRetryCount: 1,
      revalidateOnFocus: false,
    },
  );

  return {
    ancestry: initialAncestry ?? data ?? EMPTY_ANCESTRY,
    isLoading: shouldFetch ? isLoading : false,
    error,
  };
}
