/**
 * useAccountNfts — every NFT an address holds (`account_nfts`), shared
 * by the NFTs tab, its badge, the Offers tab and the overview's bids.
 *
 * Dedups on NFTokenID: `account_nfts` can repeat entries across page
 * boundaries, which shows up as duplicate React keys.
 */

import { useMemo } from "react";
import { collectPages, PAGE_CAP, walkOutcome, XRPL_MAX_LIMIT, type Walk } from "@/lib/xrpl-pagination";
import type { NFTBrowseItem } from "@/types/nft";
import { ACCOUNT_DATA_MAX_AGE_MS, useXrplQuery } from "./useXrplQuery";

const NONE: NFTBrowseItem[] = [];

function dedupe(nfts: NFTBrowseItem[]): NFTBrowseItem[] {
  const seen = new Set<string>();
  return nfts.filter((nft) => !seen.has(nft.NFTokenID) && !!seen.add(nft.NFTokenID));
}

export function useAccountNfts(address: string) {
  const { data, error, isLoading, retry } = useXrplQuery<Walk<NFTBrowseItem>>(
    address ? ["account-nfts", address] : null,
    async ({ send, signal }) => {
      const walk = walkOutcome(
        await collectPages<NFTBrowseItem>(
          send,
          { command: "account_nfts", account: address, ledger_index: "validated", limit: XRPL_MAX_LIMIT },
          (page) => page.account_nfts as NFTBrowseItem[] | undefined,
          { maxPages: PAGE_CAP, signal },
        ),
      );
      return { ...walk, items: dedupe(walk.items) };
    },
    { maxAgeMs: ACCOUNT_DATA_MAX_AGE_MS },
  );

  return useMemo(
    () => ({
      nfts: data?.items ?? NONE,
      isLoading,
      error,
      truncated: !!data?.truncated,
      partial: !!data?.partial,
      retry,
    }),
    [data, error, isLoading, retry],
  );
}
