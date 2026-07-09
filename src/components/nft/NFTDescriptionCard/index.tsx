"use client";

import CollapsibleCard from "@/components/shared/CollapsibleCard";
import { useNFTMetadata } from "@/hooks/useNFTMetadata";

/**
 * Description + name from off-chain JSON metadata, surfaced as the
 * topmost collapsible card on the NFT detail page (above Details
 * and Properties). Returns null when the metadata didn't carry a
 * description and a name — there's nothing to show, no point
 * rendering an empty card.
 *
 * Shares the metadata fetch with NFTImageCard / NFTPropertiesCard
 * via `useNFTMetadata` (SWR-deduped) so all three cards trigger
 * one network request, not three.
 */
export default function NFTDescriptionCard({
  uri,
  lockOpen,
}: {
  uri: string | null;
  lockOpen?: boolean;
}) {
  const { metadata, isLoading } = useNFTMetadata(uri);

  // Don't render the card at all when there's nothing to show. A
  // collapsed-but-empty header would be visual noise.
  if (!isLoading && !metadata?.name && !metadata?.description) return null;

  return (
    <CollapsibleCard
      title="Description"
      storageKey="nft-description"
      lockOpen={lockOpen}
    >
      <div className="space-y-3 px-4 py-4">
        {isLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading description">
            <div className="h-5 w-2/3 animate-pulse motion-reduce:animate-none rounded bg-elevated" />
            <div className="h-4 w-full animate-pulse motion-reduce:animate-none rounded bg-elevated" />
            <div className="h-4 w-4/5 animate-pulse motion-reduce:animate-none rounded bg-elevated" />
          </div>
        ) : (
          <>
            {metadata?.name && (
              <h3 className="font-display text-heading font-semibold text-primary">
                {metadata.name}
              </h3>
            )}
            {metadata?.description && (
              <p className="font-body text-ui leading-relaxed text-secondary">
                {metadata.description}
              </p>
            )}
          </>
        )}
      </div>
    </CollapsibleCard>
  );
}
