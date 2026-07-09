"use client";

import NFTCard from "@/components/account/NFTCard";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import ValuationLine from "./ValuationLine";
import type { CollectionValuation, NormalizedNFT } from "./types";

interface ResolvedRow {
  name: string | null;
  imageUrl: string | null;
}

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
  loading,
  valuation,
}: {
  collection: { key: string; issuer: string; taxon: number; nfts: NormalizedNFT[] };
  name: string | null;
  resolved: Map<string, ResolvedRow>;
  loading: boolean;
  valuation?: CollectionValuation;
}) {
  const { visible, hasMore, loadMore, showAll } = usePagination(
    collection.nfts.length,
    PAGE_SIZE,
  );
  const pageNfts = collection.nfts.slice(0, visible);
  const showValuation =
    valuation !== undefined && valuation.totalValueXrp > 0;

  return (
    <div>
      {/* Heading allows wrap on narrow phones — name + count keep
           their row, valuation drops to the next line rather than
           overflowing the container. */}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 px-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-mono text-cell font-medium text-primary">
            {name ?? `Collection #${collection.taxon}`}
          </span>
          <span className="shrink-0 font-mono text-label text-muted">
            {collection.nfts.length} item
            {collection.nfts.length !== 1 ? "s" : ""}
          </span>
        </div>
        {showValuation && <ValuationLine valuation={valuation} />}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {pageNfts.map((nft) => {
          const meta = resolved.get(nft.nftId);
          return (
            <NFTCard
              key={nft.nftId}
              nftId={nft.nftId}
              serial={nft.serial}
              name={meta?.name ?? null}
              imageUrl={meta?.imageUrl ?? null}
              loading={loading && !meta}
              highestBidXrp={nft.highestBidXrp}
            />
          );
        })}
      </div>
      {hasMore && (
        <div className="mt-4 overflow-hidden rounded-2xl bg-surface shadow-card">
          <LoadMoreFooter
            visible={visible}
            total={collection.nfts.length}
            onLoadMore={loadMore}
            onShowAll={showAll}
            label="NFTs"
            className="border-t-0"
          />
        </div>
      )}
    </div>
  );
}
