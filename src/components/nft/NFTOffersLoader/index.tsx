import NFTOfferTable from "@/components/nft/NFTOfferTable";
import { xrplClient } from "@/lib/xrpl-client";
import type { NFTOffer } from "@/types/nft";

/**
 * Streamed offers slot for the NFT detail page. Paginates buy + sell
 * offers in parallel, renders both tables. Mirrors the streaming
 * pattern the account page uses (`HeatmapSlot`, `CounterpartiesSlot`,
 * etc.) — the parent wraps this in <Suspense> so the page shell +
 * image render immediately and the offer tables stream in when
 * rippled finishes paginating.
 *
 * Pre-streaming: page.tsx awaited buy + sell paginate (up to 10 pages
 * × 500 offers each side) before sending HTML, gating TTFB by
 * 1–3s+ on popular NFTs. Now the only thing on the SSR critical path
 * is `getNFTInfo` (~50–200ms).
 */
export default async function NFTOffersLoader({ nftId }: { nftId: string }) {
  const [buyOffers, sellOffers] = await Promise.all([
    paginateOffers("buy", nftId).catch(() => []),
    paginateOffers("sell", nftId).catch(() => []),
  ]);

  // Both sides empty → render nothing. NFTOfferTable returns null
  // for empty input, but if both are empty we'd still emit the
  // 2-col grid wrapper (with `gap-6` adding a chunk of empty
  // vertical space on the page) for nothing.
  if (buyOffers.length === 0 && sellOffers.length === 0) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <NFTOfferTable offers={sellOffers} type="sell" />
      <NFTOfferTable offers={buyOffers} type="buy" />
    </div>
  );
}

/** Walk every page of buy or sell offers up to a 10-page cap. The
 *  500-per-page limit is rippled's max, so most NFTs settle in one
 *  call. Cap protects against pathological NFTs with thousands of
 *  legacy offers. */
async function paginateOffers(
  side: "buy" | "sell",
  nftId: string,
): Promise<NFTOffer[]> {
  const fetcher =
    side === "buy" ? xrplClient.getNFTBuyOffers : xrplClient.getNFTSellOffers;
  let all: NFTOffer[] = [];
  let marker: unknown = undefined;
  for (let page = 0; page < 10; page++) {
    try {
      const res = await fetcher.call(xrplClient, nftId, marker);
      all = all.concat(res.offers ?? []);
      marker = res.marker;
      if (!marker) break;
    } catch {
      break;
    }
  }
  return all;
}
