"use client";

/**
 * useAccountObjects — paginated `account_objects` for an XRPL address,
 * partitioned into the views the non-trustline tabs care about.
 *
 * Returns escrows, paychannels, MPTokens, and MPTokenIssuances plus the
 * raw `objects` array (for consumers that count "all ledger objects").
 * Trustlines are NOT in this shape anymore — they come from CH via
 * `useAccountTrustLines` (commit 3bd5d4e), which is dramatically faster
 * for accounts with many trustlines. Whales with 10k+ trustlines used
 * to wait 5–10s on the rippled paginate-all here just to fetch trustline
 * data; the CH mirror serves them in <100ms.
 *
 * The rippled paginate-all is still here because escrow/channel/MPT
 * state isn't mirrored yet. Once they are, this hook will go away too.
 *
 * SWR-keyed on `account-objects:${address}` so multiple consumers
 * (PositionsTab, OffersTab, ProfileTab) share one fetch.
 */

import useSWR from "swr";
import { useEffect, useRef } from "react";
import { useXrpl } from "./useXrplWs";
import { PAGE_CAP, XRPL_MAX_LIMIT, type SendFn } from "@/lib/xrpl-pagination";
import type { AccountObjectsResult } from "@/types/xrpl";

async function fetchAllObjects(
  address: string,
  send: SendFn,
): Promise<Record<string, unknown>[]> {
  let objects: Record<string, unknown>[] = [];
  try {
    const first = (await send({
      command: "account_objects",
      account: address,
      ledger_index: "validated",
      limit: XRPL_MAX_LIMIT,
    })) as AccountObjectsResult;
    objects = first.account_objects ?? [];
    let marker = first.marker;
    let page = 0;
    while (marker && page < PAGE_CAP) {
      const next = (await send({
        command: "account_objects",
        account: address,
        ledger_index: "validated",
        limit: XRPL_MAX_LIMIT,
        marker,
      })) as AccountObjectsResult;
      objects = objects.concat(next.account_objects ?? []);
      marker = next.marker;
      page++;
    }
  } catch {
    /* partial — return what we have */
  }
  return objects;
}

export interface AccountObjectsViews {
  isLoading: boolean;
  error: unknown;
  /** Raw account_objects payload, all LedgerEntryTypes. Includes
   *  RippleState entries for consumers that just want a count of all
   *  ledger objects (e.g. ProfileTab); use `useAccountTrustLines` for
   *  trustline data specifically. */
  objects: Record<string, unknown>[];
  escrows: Record<string, unknown>[];
  channels: Record<string, unknown>[];
  mpTokens: Record<string, unknown>[];
  mpTokenIssuances: Record<string, unknown>[];
}

export function useAccountObjects(address: string): AccountObjectsViews {
  const { send, connected } = useXrpl();
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const { data, error, isLoading } = useSWR(
    connected ? `account-objects:${address}` : null,
    () => fetchAllObjects(address, sendRef.current),
    {
      dedupingInterval: 10_000,
      keepPreviousData: true,
      errorRetryCount: 2,
      revalidateOnFocus: false,
    },
  );

  const objects = data ?? [];
  return {
    isLoading,
    error,
    objects,
    escrows: objects.filter((o) => o.LedgerEntryType === "Escrow"),
    channels: objects.filter((o) => o.LedgerEntryType === "PayChannel"),
    mpTokens: objects.filter((o) => o.LedgerEntryType === "MPToken"),
    mpTokenIssuances: objects.filter(
      (o) => o.LedgerEntryType === "MPTokenIssuance",
    ),
  };
}
