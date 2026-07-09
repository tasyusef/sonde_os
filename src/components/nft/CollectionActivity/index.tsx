import { getCollectionActivity } from "@/lib/db-queries";
import ActivityTable from "./ActivityTable";

const PAGE_SIZE = 15;

/**
 * Trades tab content — server-renders the first page of trades for
 * the collection, then hands off to `ActivityTable` (client) which
 * supports paginated "Load more" via
 * `/api/nft/collection/[issuer]/[taxon]/activity`.
 *
 * Mirrors the portfolio activity-tab pagination pattern.
 */
export default async function CollectionActivity({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  const rows = await getCollectionActivity(issuer, taxon, PAGE_SIZE).catch(
    () => [],
  );

  if (rows.length === 0) {
    return (
      <section className="rounded-2xl bg-surface shadow-card">
        <div className="border-b border-elevated px-4 py-card-header">
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            Trades
          </span>
        </div>
        <div className="p-8 text-center">
          <p className="font-mono text-cell text-muted">No trades yet.</p>
        </div>
      </section>
    );
  }

  return <ActivityTable initialRows={rows} issuer={issuer} taxon={taxon} />;
}
