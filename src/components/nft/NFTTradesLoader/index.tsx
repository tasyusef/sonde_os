import { getRecentNFTTrades } from "@/lib/db-queries";
import RecentTrades, {
  type RecentNFTTrade,
} from "@/components/nft/RecentTrades";
import {
  getNFTMetadataBatch,
  type ResolvedNFT,
} from "@/lib/nft-metadata-resolver";

/**
 * Async server component — reads the 10 most recent NFT trades from CH
 * and resolves display name + image for each NFT via the metadata cache.
 * Wrapped in <Suspense> by the NFT page so it streams independently.
 *
 * Hard 2-second cap on the metadata batch. On cold cache, the batch
 * walks `nft_info` lookups (Clio) and IPFS fetches per row; a single
 * slow gateway used to stall the entire trades card. With the cap, we
 * render trades with whatever names+images resolved in time and rely
 * on the cache filling up across requests rather than blocking this
 * one. Names/images that didn't make the deadline fall back to the
 * truncated nftokenId, same as the cache-miss fallback.
 */
const METADATA_TIMEOUT_MS = 2_000;

export default async function NFTTradesLoader() {
  const trades = await getRecentNFTTrades().catch(() => []);
  if (trades.length === 0) return <RecentTrades trades={[]} />;

  const resolved = await Promise.race<Map<string, ResolvedNFT>>([
    getNFTMetadataBatch(trades.map((t) => ({ nftokenId: t.nftokenId }))).catch(
      () => new Map<string, ResolvedNFT>(),
    ),
    new Promise<Map<string, ResolvedNFT>>((resolve) =>
      setTimeout(() => resolve(new Map<string, ResolvedNFT>()), METADATA_TIMEOUT_MS),
    ),
  ]);

  const enriched: RecentNFTTrade[] = trades.map((t) => {
    const meta = resolved.get(t.nftokenId);
    return {
      ...t,
      name: meta?.name ?? null,
      imageUrl: meta?.imageUrl ?? null,
    };
  });

  return <RecentTrades trades={enriched} />;
}
