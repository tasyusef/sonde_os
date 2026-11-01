import { useMemo } from "react";
import ListNotice from "@/components/shared/ListNotice";
import LoadingDots from "@/components/shared/LoadingDots";
import { useNftRows, useRequestNfts } from "@/hooks/useNftRows";
import { pickCollectionName } from "@/lib/nft-name-helpers";
import CollectionRow from "./CollectionRow";
import SingleCollectionView from "./SingleCollectionView";
import { toNftRequest, type CollectionsViewProps, type NormalizedNFT } from "./types";

export type { CollectionsViewProps, NormalizedNFT } from "./types";

interface CollectionGroup {
  key: string;
  issuer: string;
  taxon: number;
  nfts: NormalizedNFT[];
}

function groupByCollection(nfts: NormalizedNFT[]): CollectionGroup[] {
  const map = new Map<string, CollectionGroup>();
  for (const nft of nfts) {
    const key = `${nft.issuer}:${nft.taxon}`;
    const existing = map.get(key);
    if (existing) {
      existing.nfts.push(nft);
    } else {
      map.set(key, {
        key,
        issuer: nft.issuer,
        taxon: nft.taxon,
        nfts: [nft],
      });
    }
  }
  return [...map.values()].sort((a, b) => b.nfts.length - a.nfts.length);
}

/** Metadata is fetched from the browser, so only a sample per
 *  collection loads up front (name + thumbnail): the first 3 NFTs of
 *  the 60 largest collections. Cards load when their grid is shown. */
const SAMPLE_PER_COLLECTION = 3;
const SAMPLED_COLLECTIONS = 60;

/**
 * NFT-collections grid for the account page's NFTs tab. Groups a
 * wallet's NFTs into `(issuer, taxon)` collections and renders an
 * accordion (or a single paginated grid when there's only one).
 *
 * Collection names resolve in two tiers:
 *   1. JSON `collection` field on per-NFT metadata. Set by mainstream
 *      issuers.
 *   2. `pickCollectionName` strict-majority consensus over the
 *      resolved per-NFT `name` fields. Strips "{Foo} #{N}" patterns.
 * Falls through to "Collection #{taxon}" when both are null.
 */
export default function CollectionsView({
  nfts,
  loadingList = false,
}: CollectionsViewProps) {
  const collections = useMemo(() => groupByCollection(nfts), [nfts]);
  const ids = useMemo(() => nfts.map((n) => n.nftId), [nfts]);
  const resolved = useNftRows(ids);

  const sample = useMemo(
    () =>
      collections
        .slice(0, SAMPLED_COLLECTIONS)
        .flatMap((c) => c.nfts.slice(0, SAMPLE_PER_COLLECTION))
        .map(toNftRequest),
    [collections],
  );
  useRequestNfts(sample);
  const sampleDone = sample.filter((s) => resolved.has(s.nftokenId)).length;

  // Two-tier collection-name resolution (JSON → consensus).
  const collectionNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const col of collections) {
      const rows = col.nfts.map((n) => resolved.get(n.nftId));
      const fromJson = rows.find((r) => r?.collectionName)?.collectionName;
      if (fromJson) {
        out.set(col.key, fromJson);
        continue;
      }
      const picked = pickCollectionName(rows.map((r) => r?.name ?? null));
      if (picked) out.set(col.key, picked);
    }
    return out;
  }, [collections, resolved]);

  // Empty / loading states. Loading takes precedence so we don't flash
  // "no NFTs" before the upstream paginator finishes.
  if (nfts.length === 0) {
    if (loadingList) {
      return (
        <p role="status" className="flex items-center gap-2 font-mono text-cell text-muted">
          <LoadingDots className="text-brand" />
          Loading NFTs…
        </p>
      );
    }
    return <ListNotice message="No NFTs held" />;
  }

  // Progress ticker + collection accordions or single-collection grid.
  return (
    <div className="space-y-3">
      <MetadataProgressRow done={sampleDone} total={sample.length} />
      {collections.length === 1 ? (
        <SingleCollectionView
          collection={collections[0]}
          name={collectionNames.get(collections[0].key) ?? null}
          resolved={resolved}
        />
      ) : (
        <div>
          {collections.map((col) => (
            <CollectionRow
              key={col.key}
              collection={col}
              name={collectionNames.get(col.key) ?? null}
              resolved={resolved}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Progress while the per-collection sample resolves (names and
 *  thumbnails). Hidden once it's done. */
function MetadataProgressRow({ done, total }: { done: number; total: number }) {
  if (done >= total) return null;
  return (
    <div
      className="flex min-h-5 items-center gap-2 font-mono text-tag text-muted"
      role="status"
      aria-live="polite"
    >
      <LoadingDots className="text-brand" />
      <span>
        Loading collection details: {done.toLocaleString()} of {total.toLocaleString()}
      </span>
    </div>
  );
}
