import { getCollectionHolders } from "@/lib/db-queries";
import HoldersList from "./HoldersList";

/**
 * Top holders of a collection — ranked by how many NFTs from
 * (issuer, taxon) they currently own. Fetches the top 15
 * server-side; tablet+ shows all 15, mobile shows the top 5 with a
 * "Show more" button revealing the rest.
 */
export default async function CollectionHolders({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  const holders = await getCollectionHolders(issuer, taxon, 15).catch(() => []);
  if (holders.length === 0) return null;

  return <HoldersList holders={holders} />;
}
