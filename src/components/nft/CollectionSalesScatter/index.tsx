import { getCollectionSalesScatter } from "@/lib/db-queries";
import CollapsibleCard from "@/components/shared/CollapsibleCard";
import SalesScatterChart from "./SalesScatterChart";

/**
 * Sales scatter chart for the collection — every XRP-denominated
 * trade in the last 90 days as a dot. Wrapped in `CollapsibleCard`
 * so the section header chevron can hide the chart entirely.
 */
export default async function CollectionSalesScatter({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  const points = await getCollectionSalesScatter(issuer, taxon, 90).catch(
    () => [],
  );

  return (
    <CollapsibleCard
      title="Sales"
      storageKey="collection-sales-scatter"
      count={points.length > 0 ? points.length : undefined}
    >
      <SalesScatterChart points={points} />
    </CollapsibleCard>
  );
}
