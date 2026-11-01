/**
 * Buy offers on an account's NFTs, summarised from one `nft_buy_offers`
 * reply per NFT. Feeds the Overview's highest-bid sum and the Offers
 * tab's Incoming list.
 */

import { isNotFoundError } from "@/lib/xrpl-errors";
import { dropsToXrp } from "@/lib/xrpl-helpers";
import type { NFTOffer } from "@/types/nft";

/** Only the account's first 50 NFTs are scanned: one request each. */
export const BID_SCAN_LIMIT = 50;

export interface NftBids {
  /** NFTokenID → highest active XRP bid, in XRP. IOU bids aren't
   *  summable into the USD total without per-token prices. */
  highestBids: Record<string, number>;
  /** NFTokenID → active (unexpired) buy offers. */
  buyOffers: Record<string, NFTOffer[]>;
  /** NFTs whose request failed (not "no offers"). */
  failed: number;
}

export function summarizeBids(
  nftIds: readonly string[],
  results: readonly PromiseSettledResult<unknown>[],
  nowXrplEpoch: number,
): NftBids {
  const out: NftBids = { highestBids: {}, buyOffers: {}, failed: 0 };
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      // `objectNotFound` is how the node says "no buy offers".
      if (!isNotFoundError(r.reason)) out.failed++;
      return;
    }
    const offers = ((r.value as { offers?: NFTOffer[] } | null)?.offers ?? []).filter(
      (o) => !o.expiration || o.expiration > nowXrplEpoch,
    );
    if (offers.length === 0) return;
    const id = nftIds[i];
    out.buyOffers[id] = offers;
    let best = 0;
    for (const o of offers) {
      if (typeof o.amount !== "string") continue;
      best = Math.max(best, parseFloat(dropsToXrp(o.amount)));
    }
    if (best > 0) out.highestBids[id] = best;
  });
  return out;
}

export interface IncomingOfferRow {
  nftId: string;
  offer: NFTOffer;
}

/**
 * One row per offer for the Incoming list, sorted for reading.
 * - XRP offers first, highest first.
 * - Then IOU offers, grouped by token (currency, then issuer), highest
 *   first within each token. Amounts in different tokens can't be
 *   compared without prices, so they're never ranked against XRP or
 *   against each other.
 */
export function incomingOfferRows(buyOffers: Record<string, NFTOffer[]>): IncomingOfferRow[] {
  const rows = Object.entries(buyOffers).flatMap(([nftId, offers]) =>
    offers.map((offer) => ({ nftId, offer })),
  );
  return rows.sort((a, b) => compareOffers(a.offer, b.offer));
}

function compareOffers(a: NFTOffer, b: NFTOffer): number {
  const aXrp = typeof a.amount === "string";
  const bXrp = typeof b.amount === "string";
  if (aXrp !== bXrp) return aXrp ? -1 : 1;
  if (typeof a.amount !== "string" && typeof b.amount !== "string") {
    const byToken =
      a.amount.currency.localeCompare(b.amount.currency) ||
      a.amount.issuer.localeCompare(b.amount.issuer);
    if (byToken) return byToken;
  }
  return (
    amountNumber(b) - amountNumber(a) || a.nft_offer_index.localeCompare(b.nft_offer_index)
  );
}

/** Drops for XRP, token units for an IOU. Only compared within one unit. */
function amountNumber(offer: NFTOffer): number {
  const n = Number(typeof offer.amount === "string" ? offer.amount : offer.amount.value);
  return Number.isFinite(n) ? n : 0;
}
