import { useMemo } from "react";
import NFTCard from "@/components/account/NFTCard";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { useRequestNfts } from "@/hooks/useNftRows";
import { toNftRequest, type NormalizedNFT, type ResolvedRow } from "./types";

const PAGE_SIZE = 24;

/**
 * Single-collection mode — when a wallet only holds one
 * `(issuer, taxon)` collection, skip the accordion and render the
 * grid directly with a paginated "Load more" footer.
 */
export default function SingleCollectionView({
  collection,
  name,
  resolved,
}: {
  collection: { key: string; issuer: string; taxon: number; nfts: NormalizedNFT[] };
  name: string | null;
  resolved: Map<string, ResolvedRow>;
}) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(
    collection.nfts.length,
    PAGE_SIZE,
  );
  const pageNfts = useMemo(() => collection.nfts.slice(0, visible), [collection.nfts, visible]);
  useRequestNfts(useMemo(() => pageNfts.map(toNftRequest), [pageNfts]), { priority: true });

  return (
    <div>
      <div className="mb-3 flex min-w-0 items-baseline gap-2">
        <span className="truncate font-mono text-cell font-medium text-primary">
          {name ?? `Collection #${collection.taxon}`}
        </span>
        <span className="shrink-0 font-mono text-label text-muted">
          {collection.nfts.length} item
          {collection.nfts.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div ref={listRef} className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {pageNfts.map((nft) => {
          const meta = resolved.get(nft.nftId);
          return (
            <NFTCard
              key={nft.nftId}
              nftId={nft.nftId}
              serial={nft.serial}
              name={meta?.name ?? null}
              imageUrl={meta?.imageUrl ?? null}
              askHost={meta?.askHost ?? null}
              loading={!meta}
            />
          );
        })}
      </div>
      {hasMore && (
        <LoadMoreFooter
          visible={visible}
          total={collection.nfts.length}
          onLoadMore={loadMore}
          onShowAll={showAll}
          label="NFTs"
          className="mt-4"
        />
      )}
    </div>
  );
}
