import Facts, { Fact } from "@/components/shared/Facts";
import Section from "@/components/shared/Section";
import Skeleton from "@/components/shared/Skeleton";
import { useNFTMetadata } from "@/hooks/useNFTMetadata";

/** The NFT's traits (`attributes` in its off-chain metadata). Omitted
 *  when the metadata has none. */
export default function NFTProperties({ uri, nftId }: { uri: string | null; nftId: string }) {
  const { metadata, isLoading, askHost } = useNFTMetadata(uri, nftId);
  const traits = metadata?.attributes ?? [];

  if (!uri || (!askHost && !isLoading && traits.length === 0)) return null;

  return (
    <Section title="Properties" count={traits.length}>
      {/* The stage holds the "Load from" button. */}
      {askHost ? (
        <p className="font-mono text-label text-muted">Metadata not loaded.</p>
      ) : isLoading ? (
        <div className="space-y-4 py-2" role="status" aria-label="Loading properties">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-4" />
          ))}
        </div>
      ) : (
        <Facts>
          {traits.map((attr, i) => (
            <Fact key={`${attr.trait_type}-${i}`} label={attr.trait_type} dataLabel>
              {attr.value}
            </Fact>
          ))}
        </Facts>
      )}
    </Section>
  );
}

export { NFTProperties };
