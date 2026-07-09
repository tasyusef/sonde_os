"use client";

/**
 * useAccountIncomingNftOffers — NFT buy offers other accounts have
 * placed on this account's NFTs, fetched via the server-side
 * aggregation endpoint `/api/account/[address]/incoming-nft-offers`.
 *
 * Replaces the old client-side fan-out in useAccountNftBids.buyOffers
 * for the OffersTab Incoming view. The server endpoint scans up to 500
 * NFTs (vs 50 client-side cap), uses the long-timeout xrplClient with
 * server-side WS, and caches the result at the edge — repeat visits
 * within 60s are instant. Single HTTP call from the client.
 *
 * AccountOverview's "Total Value" stat still uses the lighter
 * useAccountNftBids browser fan-out for its highest-bid sum; that
 * stat is an estimate and doesn't need exhaustive coverage.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { NFTOffer } from "@/types/nft";

export interface IncomingNftOfferEntry {
  nftId: string;
  offer: NFTOffer;
}

interface IncomingNftOffersResponse {
  offers: IncomingNftOfferEntry[];
  /** Total NFTs the account holds across all rippled pages. */
  totalNfts: number;
  /** How many NFTs we actually scanned for offers. <= MAX_NFTS_TO_SCAN
   *  on the server (currently 500). */
  scannedNfts: number;
  /** True when totalNfts > scannedNfts — UI surfaces a "first N of M"
   *  note in the section header. */
  truncated: boolean;
  error?: string;
}

export function useAccountIncomingNftOffers(address: string) {
  const { data, error, isLoading } = useSWR<IncomingNftOffersResponse>(
    address ? `/api/account/${address}/incoming-nft-offers` : null,
    fetcher,
    {
      dedupingInterval: 60_000,
      keepPreviousData: true,
      errorRetryCount: 1,
      revalidateOnFocus: false,
    },
  );

  return {
    offers: data?.offers ?? [],
    totalNfts: data?.totalNfts ?? 0,
    scannedNfts: data?.scannedNfts ?? 0,
    truncated: data?.truncated ?? false,
    isLoading,
    error,
  };
}
