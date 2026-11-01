import { useMemo } from "react";
import useSWR from "swr";
import { hexToUtf8 } from "@/lib/hex";
import { fetchNftMetadata } from "@/lib/nft-metadata";
import type { NFTAttribute } from "@/types/nft";
import { useMediaApproval } from "./useMediaApproval";

export interface NFTMetadata {
  imageUrl: string | null;
  name: string | null;
  description: string | null;
  attributes: NFTAttribute[] | null;
}

/**
 * Metadata for one hex NFT URI, fetched in the browser (gateway
 * fallback in `nft-metadata.ts`). The NFT detail cards share it through
 * the SWR key, so the gateway chain runs once per URI.
 *
 * On a host that needs the visitor's OK, nothing loads: `askHost` names
 * it and `approve` allows it for this NFT.
 */
export function useNFTMetadata(uri: string | null, nftId: string) {
  const raw = useMemo(() => (uri ? hexToUtf8(uri).trim() : null), [uri]);
  const { askHost, approve } = useMediaApproval(nftId, raw);
  const { data, error, isLoading } = useSWR<NFTMetadata | null>(
    uri && !askHost ? ["nft-metadata", uri] : null,
    ([, hex]: [string, string]) => fetchNftMetadata(hex, { priority: true }),
    {
      revalidateOnFocus: false,
      // Metadata is immutable per URI.
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60_000,
    },
  );

  return { metadata: data ?? null, error, isLoading, askHost, approve };
}
