import AMMList from "@/components/tokens/AMMList";
import { getAMMListingForTable } from "@/lib/amm-data";

/**
 * Server-side loader for the AMM listing on /markets (AMMs tab).
 * Fetches the first page (100 pools by TVL DESC) and hands it to the
 * client-side `AMMList`, which owns SWR + pagination + filter state.
 * Single PG query (parallel COUNT + page fetch) — no XRPL WS calls, no
 * ClickHouse round-trips.
 */
export default async function AMMListLoader() {
  const result = await getAMMListingForTable(0, 100).catch(() => null);

  if (!result) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-cell text-error">
          Failed to load AMM pool data
        </p>
      </div>
    );
  }

  return (
    <AMMList
      initialPools={result.pools}
      initialTotal={result.total}
      initialHasMore={result.hasMore}
    />
  );
}
