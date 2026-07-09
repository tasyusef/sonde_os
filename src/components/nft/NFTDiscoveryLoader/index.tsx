import NFTTopMarketplaces from "@/components/nft/NFTTopMarketplaces";
import NFTTopCollections from "@/components/nft/NFTTopCollections";

/**
 * NFT discovery row — Top Marketplaces + Top Collections side-by-side.
 *
 * Pre-2026-05-10 this was an async server component that pre-fetched
 * both periods (day + all) of each card and passed them as props.
 * The cards are now self-fetching via SWR + their dedicated rankings
 * routes, so this wrapper is just a layout shell — kept as a server
 * component for SEO / SSR but does no work itself.
 */
export default function NFTDiscoveryLoader() {
  return (
    <div className="mb-6 grid gap-6 sm:grid-cols-2">
      <NFTTopMarketplaces />
      <NFTTopCollections />
    </div>
  );
}
