"use client";

/**
 * useAccountNftBids — fan out `nft_buy_offers` across the account's first
 * 50 NFTs in parallel. Returns both:
 *
 *   - `highestBids`: NFTokenID → highest-active-XRP-bid (filters out
 *     expired offers and IOU-amount offers since they're not directly
 *     comparable in the Overview "Total Value" sum)
 *   - `buyOffers`: NFTokenID → full NFTOffer[] (all active offers per
 *     NFT, used by the Offers tab's Incoming view to render an offer
 *     list with offerer/amount/expiration columns)
 *
 * Both are derived from the same fetch — no extra WS calls. Capped at
 * 50 NFTs because we don't want to fan out hundreds of WS messages on
 * heavy collections; the Overview stat is a rough estimate and the
 * Incoming view notes "showing offers on top 50 NFTs" when relevant.
 *
 * Result paired with the NFT-set key it was computed against. When the
 * input changes, the derivation returns empty until the next fetch
 * re-pairs — no stale data shown, no setState-in-effect needed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useXrpl } from "./useXrplWs";
import { dropsToXrp, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import type { NFTBrowseItem, NFTOffer } from "@/types/nft";

export interface AccountNftBidsResult {
  highestBids: Record<string, number>;
  buyOffers: Record<string, NFTOffer[]>;
}

const EMPTY_RESULT: AccountNftBidsResult = {
  highestBids: {},
  buyOffers: {},
};

export function useAccountNftBids(
  nfts: NFTBrowseItem[],
): AccountNftBidsResult {
  const { send, connected } = useXrpl();
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const nftsToValue = useMemo(() => nfts.slice(0, 50), [nfts]);

  // Stable key on the first 50 NFT IDs — invariant under array-ref churn
  // when the underlying NFT set is unchanged.
  const nftKey = useMemo(
    () => nftsToValue.map((n) => n.NFTokenID).sort().join("|"),
    [nftsToValue],
  );

  const nftsRef = useRef(nftsToValue);
  useEffect(() => {
    nftsRef.current = nftsToValue;
  }, [nftsToValue]);

  const [bidsState, setBidsState] = useState<{
    key: string;
    result: AccountNftBidsResult;
  }>({ key: "", result: EMPTY_RESULT });

  useEffect(() => {
    if (!connected || nftKey === "") return;
    const sendNow = sendRef.current;
    const targets = nftsRef.current;
    let cancelled = false;

    const nowXrplEpoch = Math.floor(Date.now() / 1000) - XRPL_EPOCH;
    Promise.allSettled(
      targets.map((nft) =>
        sendNow({
          command: "nft_buy_offers",
          nft_id: nft.NFTokenID,
          limit: 50,
        }),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const highestBids: Record<string, number> = {};
        const buyOffers: Record<string, NFTOffer[]> = {};
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status !== "fulfilled" || !r.value) continue;
          const offers = (r.value as { offers?: NFTOffer[] }).offers ?? [];
          if (offers.length === 0) continue;
          // Filter out already-expired offers from the Incoming list —
          // they're not actionable. Same gate the highest-bid loop uses.
          const activeOffers = offers.filter(
            (o) => !o.expiration || o.expiration > nowXrplEpoch,
          );
          if (activeOffers.length === 0) continue;
          buyOffers[targets[i].NFTokenID] = activeOffers;

          let highestXrpBid = 0;
          for (const offer of activeOffers) {
            // XRP-only for the highest-bid stat; IOU bids aren't summable
            // into the Overview's USD "Total Value" without per-token
            // pricing, which we don't have for NFT bid currencies.
            if (typeof offer.amount !== "string") continue;
            const xrp = parseFloat(dropsToXrp(offer.amount));
            if (xrp > highestXrpBid) highestXrpBid = xrp;
          }
          if (highestXrpBid > 0) {
            highestBids[targets[i].NFTokenID] = highestXrpBid;
          }
        }
        setBidsState({ key: nftKey, result: { highestBids, buyOffers } });
      })
      .catch(() => {
        /* partial — keep what we have */
      });

    return () => {
      cancelled = true;
    };
  }, [nftKey, connected]);

  return bidsState.key === nftKey ? bidsState.result : EMPTY_RESULT;
}
