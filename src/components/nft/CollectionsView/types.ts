import type { NftRequest } from "@/lib/nft-metadata";

/**
 * Normalized shape for an NFT in a collection grid. The account page
 * maps XRPL `account_nfts` rows to this before handing off to
 * `CollectionsView`.
 */
export interface NormalizedNFT {
  nftId: string;
  issuer: string;
  taxon: number;
  serial: number;
  /** Hex-encoded URI from the source. Empty string when the NFT has
   *  no URI. */
  uri: string;
}

/** Name + image for a card; a missing entry means still loading. */
export interface ResolvedRow {
  name: string | null;
  imageUrl: string | null;
  /** Metadata host waiting for the visitor's OK. */
  askHost: string | null;
}

export const toNftRequest = (nft: NormalizedNFT): NftRequest => ({
  nftokenId: nft.nftId,
  uri: nft.uri,
});

export interface CollectionsViewProps {
  /** All NFTs to render, normalized. Grouping into collections happens
   *  inside the view so callers don't need to pre-bucket. */
  nfts: NormalizedNFT[];
  /** True while the upstream NFT list is still paginating (XRPL
   *  `account_nfts`). Surfaces as "Loading NFTs…" before any cards
   *  render. */
  loadingList?: boolean;
}
