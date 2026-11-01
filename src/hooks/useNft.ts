import { useMemo } from "react";
import { nftHistoryRows, type NftHistoryEntry } from "@/lib/nft-history";
import { nftInfoFromId } from "@/lib/nft-utils";
import { isNotFoundError } from "@/lib/xrpl-errors";
import { collectPages, walkOrNone, walkOutcome } from "@/lib/xrpl-pagination";
import type { NFTHistoryTransaction, NFTInfo, NFTOffer } from "@/types/nft";
import { useXrplQuery } from "./useXrplQuery";

export const NFT_ID_RE = /^[A-Fa-f0-9]{64}$/;

/** 10 × 500 offers per side; rippled's max page is 500. */
const OFFER_PAGES = 10;
export const OFFER_CAP = OFFER_PAGES * 500;
/** 4 × 50 history entries (Clio's page size). */
const HISTORY_PAGES = 4;
export const HISTORY_CAP = HISTORY_PAGES * 50;

/** The NFT itself (`nft_info`, Clio). When Clio can't be reached the
 *  page still renders from what the ID encodes. */
export function useNftInfo(id: string) {
  const valid = NFT_ID_RE.test(id);
  const nftId = id.toUpperCase();
  const { data, error, unreachable, retry } = useXrplQuery<NFTInfo>(
    valid ? ["nft-info", nftId] : null,
    async ({ send }) => {
      const res = (await send({ command: "nft_info", nft_id: nftId })) as NFTInfo;
      return { ...res, uri: res.uri || null };
    },
    { shouldRetryOnError: (err) => !isNotFoundError(err) },
  );
  const notFound = isNotFoundError(error);
  const fallback = useMemo(
    () => (error && !notFound ? nftInfoFromId(nftId) : null),
    [error, notFound, nftId],
  );
  return { nft: data ?? fallback, valid, notFound, unreachable, retry };
}

/** Open buy and sell offers. `objectNotFound` means none; any other
 *  failure is an error, never an empty list. */
export function useNftOffers(id: string) {
  const nftId = id.toUpperCase();
  const { data, error, isLoading, retry } = useXrplQuery(
    NFT_ID_RE.test(id) ? ["nft-offers", nftId] : null,
    async ({ send, signal }) => {
      const side = (command: string) =>
        collectPages<NFTOffer>(
          send,
          { command, nft_id: nftId, limit: 500 },
          (page) => page.offers as NFTOffer[] | undefined,
          { maxPages: OFFER_PAGES, signal },
        ).then(walkOrNone);
      const [buy, sell] = await Promise.all([side("nft_buy_offers"), side("nft_sell_offers")]);
      return {
        buy: buy.items,
        sell: sell.items,
        partial: buy.partial || sell.partial,
        truncated: buy.truncated || sell.truncated,
      };
    },
  );
  return {
    buy: data?.buy ?? [],
    sell: data?.sell ?? [],
    isLoading,
    failed: !!error && !isLoading,
    partial: data?.partial ?? false,
    truncated: data?.truncated ?? false,
    retry,
  };
}

/** Recent transactions touching the NFT (`nft_history`, Clio), newest
 *  first, up to `HISTORY_CAP`. `more` says older ones exist past the
 *  cap. Shared by the history table and the burn note. */
export function useNftHistory(id: string) {
  const nftId = id.toUpperCase();
  const { data, error, isLoading, retry } = useXrplQuery<{
    rows: NFTHistoryTransaction[];
    more: boolean;
  }>(
    NFT_ID_RE.test(id) ? ["nft-history", nftId] : null,
    async ({ send, signal }) => {
      const res = await collectPages<NftHistoryEntry>(
        send,
        { command: "nft_history", nft_id: nftId, limit: 50 },
        (page) => page.transactions as NftHistoryEntry[] | undefined,
        { maxPages: HISTORY_PAGES, signal },
      );
      if (res.error && res.items.length === 0) throw res.error;
      return { rows: nftHistoryRows(res.items), more: walkOutcome(res).truncated };
    },
  );
  return { rows: data?.rows ?? null, more: data?.more ?? false, failed: !!error && !isLoading, retry };
}
