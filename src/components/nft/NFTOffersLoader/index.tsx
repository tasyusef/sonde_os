import NFTOfferTable from "@/components/nft/NFTOfferTable";
import ListNotice from "@/components/shared/ListNotice";
import Skeleton from "@/components/shared/Skeleton";
import { OFFER_CAP, useNftOffers } from "@/hooks/useNft";

/** The NFT page's open offers, both sides, loaded in the browser. */
export default function NFTOffersLoader({ nftId, className }: { nftId: string; className?: string }) {
  const { buy, sell, isLoading, failed, partial, truncated, retry } = useNftOffers(nftId);

  if (isLoading) {
    return (
      <div className={className} role="status" aria-label="Loading NFT offers">
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (failed) {
    return (
      <div className={className}>
        <ListNotice
          tone="error"
          message="Couldn't load this NFT's offers."
          action={{ label: "Try again", onClick: retry }}
        />
      </div>
    );
  }

  const note = partial
    ? "Some offers couldn't be loaded."
    : truncated
      ? `Only the first ${OFFER_CAP.toLocaleString()} per side are loaded.`
      : null;
  // Both empty: render nothing, so no blank band holds their place.
  if (buy.length === 0 && sell.length === 0 && !note) return null;

  return <NFTOfferTable sell={sell} buy={buy} note={note} className={className} />;
}
