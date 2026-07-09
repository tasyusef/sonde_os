import { getCollectionListingPrices } from "@/lib/db-queries";
import CollapsibleCard from "@/components/shared/CollapsibleCard";
import ListingHistogramChart from "./ListingHistogramChart";

/**
 * Listing-distribution histogram for the collection — horizontal
 * bars showing how many NFTs are listed for sale at various price
 * ranges. Helps visualize where most sellers are pricing relative
 * to the current floor. Wrapped in `CollapsibleCard` so the chevron
 * can hide the chart.
 */
export default async function CollectionListingHistogram({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  const rows = await getCollectionListingPrices(issuer, taxon).catch(() => []);
  const prices = rows.map((r) => r.priceXrp);

  return (
    <CollapsibleCard
      title="Listings"
      storageKey="collection-listing-histogram"
      count={prices.length > 0 ? prices.length : undefined}
    >
      <ListingHistogramChart prices={prices} />
    </CollapsibleCard>
  );
}
