import { getCollectionDailySnapshots } from "@/lib/db-queries";
import CollapsibleCard from "@/components/shared/CollapsibleCard";
import HoldersOverTimeChart from "./HoldersOverTimeChart";

/**
 * Unique-holder count over time for the collection. Daily snapshots
 * from `nft_collection_daily_snapshots`. Sparse for the first few
 * days after the snapshot pipeline launches.
 */
export default async function CollectionHoldersOverTime({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  // Log read failures rather than swallowing them (see the matching
  // comment in CollectionFloorListings for the cautionary tale).
  const points = await getCollectionDailySnapshots(issuer, taxon, 90).catch(
    (err) => {
      console.error(
        "[CollectionHoldersOverTime] Snapshot query failed",
        { issuer, taxon },
        err,
      );
      return [];
    },
  );

  return (
    <CollapsibleCard title="Holders Trend" storageKey="collection-holders-trend">
      <HoldersOverTimeChart points={points} />
    </CollapsibleCard>
  );
}
