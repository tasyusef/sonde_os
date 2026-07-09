"use client";

import { useMemo } from "react";
import CollectionsView from "@/components/nft/CollectionsView";
import type { NormalizedNFT } from "@/components/nft/CollectionsView";
import type { NFToken } from "@/components/account/NFTList";

/**
 * Account-page NFT grid — thin wrapper around the shared
 * `CollectionsView`. Maps `NFToken[]` (the XRPL `account_nfts` shape)
 * to the normalized props the shared view expects, then defers all
 * rendering + metadata resolution to the shared component.
 *
 * Account doesn't surface valuations or a totals header — it just
 * renders the grid. Portfolio (`NFTHoldings`) is the same shared view
 * with `valuations` + `totals` + `title` passed in.
 */
export default function NFTGrid({
  nfts,
  loadingList = false,
}: {
  nfts: NFToken[];
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
