import { getCollectionVolumeOverTime } from "@/lib/db-queries";
import CollapsibleCard from "@/components/shared/CollapsibleCard";
import VolumeBarChart from "./VolumeBarChart";

/**
 * Daily XRP-trade volume bar chart for the collection — one bar per
 * day over the last 90 days. Uses existing `nft_trades` data, no
 * new snapshot pipeline. Wrapped in `CollapsibleCard` so the header
 * chevron can hide the chart.
 *
 * This is the volume slice of the eventual floor/volume/listings
 * combo chart the user requested. Floor + listings counts require
 * a per-collection daily-snapshot pipeline that ships in a
 * follow-up phase.
 */
export default async function CollectionVolumeChart({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  const points = await getCollectionVolumeOverTime(issuer, taxon, 90).catch(
    () => [],
  );
  const totalVolume = points.reduce((sum, p) => sum + p.volumeXrp, 0);

  return (
    <CollapsibleCard
      title="Volume"
      storageKey="collection-volume-chart"
      count={totalVolume > 0 ? Math.round(totalVolume) : undefined}
    >
      <VolumeBarChart points={points} />
    </CollapsibleCard>
  );
}
