"use client";

/**
 * useAccountMintedNfts — lifetime NFTs minted BY this account, fetched
 * from `/api/account/[address]/minted-nfts` (CH-backed).
 *
 * Returns the same `NFTBrowseItem[]` shape as `useAccountNfts` so the
 * NFTGrid component can render either source without modification.
 *
 * Bounded by the `transactions` 12-month backfill window — mints older
 * than that don't appear. Capped at 5000 items per fetch.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { NFTBrowseItem } from "@/types/nft";

interface MintedResponse {
  nfts: NFTBrowseItem[];
  error?: string;
}

export function useAccountMintedNfts(address: string) {
  const { data, error, isLoading } = useSWR<MintedResponse>(
    address ? `/api/account/${address}/minted-nfts` : null,
    fetcher,
    {
      dedupingInterval: 60_000,
      keepPreviousData: true,
      errorRetryCount: 1,
      revalidateOnFocus: false,
    },
  );

  return {
    nfts: data?.nfts ?? [],
    isLoading,
    error,
  };
}
