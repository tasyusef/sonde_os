"use client";

/**
 * useAccountNfts — paginated `account_nfts` for an XRPL address.
 *
 * Independent of useAccountObjects so the NFTs tab can render off its
 * own data. SWR-keyed on `account-nfts:${address}`.
 *
 * Dedups on NFTokenID — `account_nfts` occasionally returns overlapping
 * entries across page boundaries, surfacing as duplicate React keys.
 *
 * Part of the per-tab data-ownership refactor (Tier 2).
 */

import useSWR from "swr";
import { useEffect, useRef } from "react";
import { useXrpl } from "./useXrplWs";
import { PAGE_CAP, XRPL_MAX_LIMIT, type SendFn } from "@/lib/xrpl-pagination";
import type { AccountNFTsResult } from "@/types/xrpl";
import type { NFTBrowseItem } from "@/types/nft";

async function fetchAllNfts(
  address: string,
  send: SendFn,
): Promise<NFTBrowseItem[]> {
  let nfts: NFTBrowseItem[] = [];
  try {
    const first = (await send({
      command: "account_nfts",
      account: address,
      limit: XRPL_MAX_LIMIT,
    })) as AccountNFTsResult;
    nfts = first.account_nfts ?? [];
    let marker = first.marker;
    let page = 0;
    while (marker && page < PAGE_CAP) {
      const next = (await send({
        command: "account_nfts",
        account: address,
        limit: XRPL_MAX_LIMIT,
        marker,
      })) as AccountNFTsResult;
      nfts = nfts.concat(next.account_nfts ?? []);
      marker = next.marker;
      page++;
    }
  } catch {
    /* partial — return what we have */
  }
  // Dedup by NFTokenID (rippled emits overlap across page boundaries).
  const seen = new Set<string>();
  return nfts.filter((nft) => {
    if (seen.has(nft.NFTokenID)) return false;
    seen.add(nft.NFTokenID);
    return true;
  });
}

export function useAccountNfts(address: string) {
  const { send, connected } = useXrpl();
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const { data, error, isLoading } = useSWR(
    connected ? `account-nfts:${address}` : null,
    () => fetchAllNfts(address, sendRef.current),
    {
      dedupingInterval: 10_000,
      keepPreviousData: true,
      errorRetryCount: 2,
      revalidateOnFocus: false,
    },
  );

  return {
    nfts: data ?? [],
    isLoading,
    error,
  };
}
