"use client";

import useSWR from "swr";
import type { NFTAttribute } from "@/types/nft";

export interface NFTMetadata {
  imageUrl: string | null;
  name: string | null;
  description: string | null;
  attributes: NFTAttribute[] | null;
}

async function fetcher(url: string): Promise<NFTMetadata | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Shared SWR-backed metadata fetch for NFT detail-page cards.
 *
 * Multiple cards on the NFT detail page (`NFTImageCard`,
 * `NFTDescriptionCard`, `NFTPropertiesCard`, the URI strip in
 * `NFTMetadataLinks`) all need the same parsed metadata blob.
 * Without sharing they'd each fire their own
 * `/api/nft-metadata?uri=…` request and the IPFS gateway chain (up
 * to 12s+ per gateway) would run multiple times in parallel for
 * the same URI. SWR dedupes on the cache key so they get one
 * fetch, one response.
 *
 * Returns the parsed metadata or null when the URI is empty / the
 * fetch failed. Also exposes `isLoading` so cards can render a
 * skeleton placeholder instead of flashing empty.
 */
export function useNFTMetadata(uri: string | null) {
  const { data, error, isLoading } = useSWR<NFTMetadata | null>(
    uri ? `/api/nft-metadata?uri=${encodeURIComponent(uri)}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      // NFT JSON metadata is immutable per URI — no need to revalidate.
      revalidateIfStale: false,
      dedupingInterval: 60_000,
    },
  );

  return { metadata: data ?? null, error, isLoading };
}
