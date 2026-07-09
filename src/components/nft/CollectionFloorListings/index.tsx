import { getCollectionDailySnapshots } from "@/lib/db-queries";
import CollapsibleCard from "@/components/shared/CollapsibleCard";
import FloorListingsChart from "./FloorListingsChart";

/**
 * Floor price + listing count combo chart for the collection. Data
 * comes from the daily `nft_collection_daily_snapshots` pipeline.
 * Sparse for the first few days after launch since snapshots only
 * start accumulating when the systemd timer first runs.
 */
export default async function CollectionFloorListings({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  // Log read failures rather than swallowing them — a silent catch
  // previously made a CH query bug (NO_COMMON_TYPE on a Date alias)
  // look indistinguishable from a brand-new collection still
  // accumulating snapshots. We'd rather see the error in server logs.
  const points = await getCollectionDailySnapshots(issuer, taxon, 90).catch(
    (err) => {
      console.error(
        "[CollectionFloorListings] Snapshot query failed",
        { issuer, taxon },
        err,
      );
      return [];
    },
  );

  return (
    <CollapsibleCard title="Floor & Listings" storageKey="collection-floor-listings">
      <FloorListingsChart points={points} />
    </CollapsibleCard>
  );
}
