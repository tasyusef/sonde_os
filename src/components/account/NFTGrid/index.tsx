import { useMemo } from "react";
import CollectionsView from "@/components/nft/CollectionsView";
import type { NormalizedNFT } from "@/components/nft/CollectionsView";
import type { NFTBrowseItem } from "@/types/nft";

/**
 * Account-page NFT grid — thin wrapper around
 * `CollectionsView`. Maps `NFTBrowseItem[]` (the XRPL `account_nfts` shape)
 * to the normalized props the view expects, then defers all
 * rendering + metadata resolution to it.
 */
export default function NFTGrid({
  nfts,
  loadingList = false,
}: {
  nfts: NFTBrowseItem[];
  /** True while `useAccountNfts` is paginating from rippled.
   *  Shown as "Loading NFTs…" before any cards render. */
  loadingList?: boolean;
}) {
  const normalized: NormalizedNFT[] = useMemo(
    () =>
      nfts.map((n) => ({
        nftId: n.NFTokenID,
        issuer: n.Issuer,
        taxon: n.NFTokenTaxon,
        serial: n.nft_serial,
        uri: n.URI ?? "",
      })),
    [nfts],
  );

  return <CollectionsView nfts={normalized} loadingList={loadingList} />;
}
