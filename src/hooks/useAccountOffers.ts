"use client";

/**
 * useAccountOffers — paginated `account_offers` for an XRPL address.
 *
 * Independent of useAccountObjects so tabs that only care about offers
 * (Positions) don't pay the trustline-paginate cost. SWR-keyed on
 * `account-offers:${address}` for cross-consumer dedup.
 *
 * Part of the per-tab data-ownership refactor (Tier 2).
 */

import useSWR from "swr";
import { useEffect, useRef } from "react";
import { useXrpl } from "./useXrplWs";
import { PAGE_CAP, XRPL_MAX_LIMIT, type SendFn } from "@/lib/xrpl-pagination";
import type { AccountOffersResult } from "@/types/xrpl";

async function fetchAllOffers(
  address: string,
  send: SendFn,
): Promise<Record<string, unknown>[]> {
  let offers: Record<string, unknown>[] = [];
  try {
    const first = (await send({
      command: "account_offers",
      account: address,
      ledger_index: "validated",
      limit: XRPL_MAX_LIMIT,
    })) as AccountOffersResult;
    offers = first.offers ?? [];
    let marker = first.marker;
    let page = 0;
    while (marker && page < PAGE_CAP) {
      const next = (await send({
        command: "account_offers",
        account: address,
        ledger_index: "validated",
        limit: XRPL_MAX_LIMIT,
        marker,
      })) as AccountOffersResult;
      offers = offers.concat(next.offers ?? []);
      marker = next.marker;
      page++;
    }
  } catch {
    /* partial — return what we have */
  }
  return offers;
}

export function useAccountOffers(address: string) {
  const { send, connected } = useXrpl();
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const { data, error, isLoading } = useSWR(
    connected ? `account-offers:${address}` : null,
    () => fetchAllOffers(address, sendRef.current),
    {
      dedupingInterval: 10_000,
      keepPreviousData: true,
      errorRetryCount: 2,
      revalidateOnFocus: false,
    },
  );

  return {
    offers: data ?? [],
    isLoading,
    error,
  };
}
