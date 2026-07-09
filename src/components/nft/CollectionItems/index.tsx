"use client";

import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import { fetcher } from "@/lib/swr-config";
import NFTCard from "@/components/nft/NFTCard";
import Button from "@/components/shared/Button";
import ResponsiveSelect from "@/components/shared/ResponsiveSelect";
import Skeleton from "@/components/shared/Skeleton";
import Toggle from "@/components/shared/Toggle";
import { type NFTBrowseItem } from "@/types/nft";

interface ApiItem {
  nftokenId: string;
  owner: string;
  uri: string | null;
  serial: number;
  isBurned: boolean;
}

interface ItemsResponse {
  items: ApiItem[];
  hasMore: boolean;
}

type Sort = "recent_mint" | "oldest_mint" | "recently_acquired";
type Filter = "live" | "burned" | "all";

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "recent_mint", label: "Newest minted" },
  { value: "oldest_mint", label: "Oldest minted" },
  { value: "recently_acquired", label: "Recently traded" },
];

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "all", label: "All" },
  { value: "burned", label: "Burned" },
];

const PAGE_SIZE = 48;

/**
 * Items grid for a collection — paginated, sortable, and filterable
 * by live / all / burned. Walks pages from
 * `/api/nft/collection/[issuer]/[taxon]/items` via useSWRInfinite.
 *
 * Filter / sort changes reset pagination because the SWR key includes
 * both — useSWRInfinite treats them as fresh paginated walks.
 *
 * Burned NFTs render through the same NFTCard with a small
 * desaturation + "BURNED" badge overlay. We don't show the burn
 * indicator inline on Live rows (they're all live anyway) — only on
 * the "All" filter where mixed live + burned needs disambiguation.
 */
export default function CollectionItems({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  const [sort, setSort] = useState<Sort>("recent_mint");
  const [filter, setFilter] = useState<Filter>("live");

  const getKey = (pageIndex: number, prev: ItemsResponse | null) => {
    if (prev && !prev.hasMore) return null;
    const offset = pageIndex * PAGE_SIZE;
    return `/api/nft/collection/${issuer}/${taxon}/items?sort=${sort}&filter=${filter}&limit=${PAGE_SIZE}&offset=${offset}`;
  };

  const { data, size, setSize, isLoading } = useSWRInfinite<ItemsResponse>(
    getKey,
    fetcher,
    { revalidateFirstPage: false },
  );

  const items: ApiItem[] = data ? data.flatMap((page) => page.items) : [];
  const hasMore = data ? data[data.length - 1]?.hasMore : false;
  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === "undefined");

  // Map ApiItem → NFTBrowseItem so we can reuse NFTCard. NFTCard
  // only reads NFTokenID, URI, and nft_serial — the rest of the
  // fields are either known from page props or unused at render time.
  const cards: Array<NFTBrowseItem & { isBurned: boolean }> = items.map((it) => ({
    NFTokenID: it.nftokenId,
    Issuer: issuer,
    URI: it.uri ?? undefined,
    Flags: 0,
    NFTokenTaxon: taxon,
    nft_serial: it.serial,
    isBurned: it.isBurned,
  }));

  return (
    <section
      aria-label="Items"
      className="overflow-hidden rounded-2xl bg-surface shadow-card"
    >
      {/* Header strip — matches the Trades/Mints/Listings/Burns tab
           pattern. Title on the left, filter + sort controls on the
           right. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-elevated px-4 py-card-header">
        <div className="flex items-center gap-3">
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            Items
          </span>
          <Toggle
            options={FILTER_OPTIONS}
            active={filter}
            onChange={(value) => {
              setFilter(value);
              setSize(1);
            }}
            ariaLabel="Filter by status"
          />
        </div>
        <ResponsiveSelect
          options={SORT_OPTIONS}
          active={sort}
          onChange={(value) => {
            setSort(value);
            setSize(1);
          }}
          ariaLabel="Sort items"
          desktopVariant="select"
        />
      </div>

      <div className="p-4">
        {isLoading && cards.length === 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full rounded-2xl" />
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-mono text-cell text-muted">
              {filter === "burned"
                ? "No burned NFTs in this collection yet."
                : filter === "live"
                  ? "No live items in this collection."
                  : "No items in this collection yet."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5">
              {cards.map((card) => (
                <div key={card.NFTokenID} className="relative">
                  <div className={card.isBurned ? "opacity-60 grayscale" : ""}>
                    <NFTCard nft={card} />
                  </div>
                  {card.isBurned && (
                    <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-tag bg-error/90 px-2 py-0.5 font-display text-tag font-bold uppercase tracking-header text-white">
                      Burned
                    </span>
                  )}
                </div>
              ))}
            </div>

            {hasMore && (
              <div className="mt-6 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => setSize(size + 1)}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
