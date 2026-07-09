import { getRecentNFTMintsFromCH } from "@/lib/db-queries";
import RecentMints from "@/components/nft/RecentMints";

/**
 * Async server component — reads the most recent NFT mints from CH's
 * `nft_static_metadata` table. Previously this called the live-ledger
 * scan in xrpl-data.ts, which issued 5 parallel `ledger`+`expand=true`
 * WebSocket commands looking for NFTokenMint transactions and could
 * stall the entire NFT page for several seconds on cold cache. The CH
 * read is a single sub-25ms query.
 *
 * Wrapped in <Suspense> by the NFT page so it streams independently.
 */
export default async function NFTMintsLoader() {
  const recentMints = await getRecentNFTMintsFromCH().catch(() => []);

  return <RecentMints mints={recentMints} />;
}
