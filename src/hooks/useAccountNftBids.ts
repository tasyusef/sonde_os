/**
 * useAccountNftBids — `nft_buy_offers` for the account's first
 * BID_SCAN_LIMIT NFTs, a few at a time. One entry per NFT set, so the
 * Overview (highest-bid sum) and the Offers tab (Incoming list) share a
 * single fan-out, fetched once (remounting the Offers tab is free).
 *
 * Partial by design: accounts holding more than 50 NFTs only get the
 * first 50 scanned, and the Offers tab says so.
 */

import { useMemo } from "react";
import { BID_SCAN_LIMIT, summarizeBids, type NftBids } from "@/lib/nft-bids";
import { XRPL_EPOCH } from "@/lib/xrpl-helpers";
import { settledPool } from "@/lib/xrpl-pagination";
import type { NFTBrowseItem } from "@/types/nft";
import { ACCOUNT_DATA_MAX_AGE_MS, useXrplQuery } from "./useXrplQuery";

/** Requests in flight at once; public nodes throttle bigger bursts. */
const CONCURRENCY = 6;

const EMPTY: NftBids = { highestBids: {}, buyOffers: {}, failed: 0 };

export interface AccountNftBidsResult extends NftBids {
  /** The fan-out for the current NFT set hasn't finished. */
  isLoading: boolean;
}

export function useAccountNftBids(nfts: NFTBrowseItem[]): AccountNftBidsResult {
  // Stable on the scanned IDs, not the array identity.
  const ids = useMemo(
    () => nfts.slice(0, BID_SCAN_LIMIT).map((n) => n.NFTokenID).sort(),
    [nfts],
  );
  const key = ids.join("|");

  const { data, isLoading } = useXrplQuery<NftBids>(
    key ? ["nft-bids", key] : null,
    async ({ send, signal }) => {
      const results = await settledPool(
        ids,
        CONCURRENCY,
        (nft_id) => send({ command: "nft_buy_offers", nft_id, limit: 50 }),
        signal,
      );
      return summarizeBids(ids, results, Math.floor(Date.now() / 1000) - XRPL_EPOCH);
    },
    { maxAgeMs: ACCOUNT_DATA_MAX_AGE_MS },
  );

  return { ...(data ?? EMPTY), isLoading };
}
