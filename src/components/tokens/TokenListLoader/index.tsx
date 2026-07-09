import TokenSearch from "@/components/tokens/TokenSearch";
import { getTokenListWithSupply } from "@/lib/token-data";

export default async function TokenListLoader({
  initialSearch,
}: {
  initialSearch?: string;
}) {
  const result = await getTokenListWithSupply(0, 100).catch(() => null);

  if (!result) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-cell text-error">
          Failed to load token data
        </p>
      </div>
    );
  }

  return (
    <TokenSearch
      initialTokens={result.tokens}
      initialTotal={result.total}
      initialHasMore={result.hasMore}
      initialSearch={initialSearch}
    />
  );
}
