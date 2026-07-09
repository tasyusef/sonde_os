"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import CollectionsView from "@/components/nft/CollectionsView";
import type {
  CollectionValuation,
  NormalizedNFT,
} from "@/components/nft/CollectionsView";

/* ——— API response shape (matches /api/portfolio/nfts) ——— */

interface NFTEntry {
  nftId: string;
  serial: number;
  uri?: string;
  highestBidXrp: number;
}

interface Collection {
  issuer: string;
  taxon: number;
  count: number;
  floorPriceXrp: number;
  totalValueXrp: number;
  totalValueUsd: number;
  nfts: NFTEntry[];
}

interface NFTsResponse {
  totalCount: number;
  totalValueXrp: number;
  totalValueUsd: number;
  xrpPrice: number;
  collections: Collection[];
}

/**
 * Portfolio NFT holdings — thin wrapper around the shared
 * `CollectionsView`. Pulls the authed user's NFTs from
 * `/api/portfolio/nfts` (XRPL-backed for ownership, CH-backed for
 * bid enrichment), flattens the API's per-collection grouping back
 * into a flat `NormalizedNFT[]` (the shared view re-groups), and
 * passes per-collection valuations + grand totals as additive props
 * so floor / total XRP / USD chrome lights up.
 *
 * Account NFT tab (`account/NFTGrid`) wraps the same shared view
 * without those props, so the visual structure + metadata pipeline
 * stay identical between the two pages.
 */
export default function NFTHoldings() {
  const { data, isLoading, error } = useSWR<NFTsResponse>(
    CACHE_KEYS.portfolioNfts(),
    fetcher,
  );

  const collections = data?.collections;

  // Flatten API collections back into a single NormalizedNFT[].
  // CollectionsView re-groups by (issuer, taxon) internally; we don't
  // need to pre-bucket. Carries `highestBidXrp` per NFT so the card
  // can show the bid pill.
  const normalized: NormalizedNFT[] = useMemo(() => {
    if (!collections) return [];
    const out: NormalizedNFT[] = [];
    for (const col of collections) {
      for (const n of col.nfts) {
        out.push({
          nftId: n.nftId,
          issuer: col.issuer,
          taxon: col.taxon,
          serial: n.serial,
          uri: n.uri ?? "",
          highestBidXrp: n.highestBidXrp,
        });
      }
    }
    return out;
  }, [collections]);

  // Per-collection valuations keyed `${issuer}:${taxon}`.
  const valuations = useMemo(() => {
    const map = new Map<string, CollectionValuation>();
    if (!collections) return map;
    for (const col of collections) {
      map.set(`${col.issuer}:${col.taxon}`, {
        floorPriceXrp: col.floorPriceXrp,
        totalValueXrp: col.totalValueXrp,
        totalValueUsd: col.totalValueUsd,
      });
    }
    return map;
  }, [collections]);

  // Error state — match the empty/error treatment the rest of the
  // portfolio page uses.
  if (error) {
    return (
      <section className="rounded-2xl shadow-card bg-surface">
        <div className="border-b border-elevated px-4 py-card-header">
          <h2 className="font-display text-label font-medium uppercase tracking-header text-muted">
            NFT Holdings
          </h2>
        </div>
        <div
          role="alert"
          className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center"
        >
          <p className="font-mono text-cell text-error">
            Couldn&apos;t load NFT holdings.
          </p>
          <p className="font-mono text-tag text-muted">
            Try refreshing the page.
          </p>
        </div>
      </section>
    );
  }

  return (
    <CollectionsView
      nfts={normalized}
      loadingList={isLoading}
      valuations={valuations}
      totals={{
        totalCount: data?.totalCount ?? 0,
        totalValueXrp: data?.totalValueXrp ?? 0,
        totalValueUsd: data?.totalValueUsd ?? 0,
      }}
      title="NFT Holdings"
    />
  );
}
