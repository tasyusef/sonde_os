"use client";

import { useState } from "react";
import Toggle from "@/components/shared/Toggle";
import NFTGrid from "@/components/account/NFTGrid";
import BurnedNFTsList from "@/components/account/BurnedNFTsList";
import { useAccountNfts } from "@/hooks/useAccountNfts";
import { useAccountMintedNfts } from "@/hooks/useAccountMintedNfts";

type NFTsView = "owned" | "minted" | "burns";

interface NFTsTabProps {
  address: string;
  burnCount: number;
  showBurns: boolean;
}

/**
 * Account NFTs tab. Three sub-views, picked via Toggle:
 *
 *   - Owned   — NFTs currently owned by the account (live, from rippled
 *               via useAccountNfts).
 *   - Minted  — NFTs ever minted BY the account (lifetime, from CH via
 *               useAccountMintedNfts; bounded by the 12-month tx
 *               backfill window).
 *   - Burns   — NFTs the account has burned (lifetime, from CH via
 *               BurnedNFTsList's own SWR fetch). Conditional — only
 *               shown when the account has burn-related history.
 *
 * Minted always appears in the Toggle so the entry is discoverable;
 * the empty state inside NFTGrid handles "this account hasn't minted
 * any NFTs" gracefully.
 *
 * NFTGrid is shape-agnostic — Owned + Minted both feed it the same
 * `NFTBrowseItem[]` and the rendering is identical. Useful for
 * issuers who appear in both views (their own minted NFTs that they
 * still hold).
 */
export default function NFTsTab({
  address,
  burnCount,
  showBurns,
}: NFTsTabProps) {
  const [view, setView] = useState<NFTsView>("owned");
  const { nfts: ownedNfts, isLoading: loadingOwned } =
    useAccountNfts(address);
  const { nfts: mintedNfts, isLoading: loadingMinted } =
    useAccountMintedNfts(address);

  const ownedCount = ownedNfts.length;
  const mintedCount = mintedNfts.length;

  const options: { value: NFTsView; label: string }[] = [
    {
      value: "owned",
      label: ownedCount > 0 ? `Owned (${ownedCount})` : "Owned",
    },
    {
      value: "minted",
      label: mintedCount > 0 ? `Minted (${mintedCount})` : "Minted",
    },
  ];
  if (showBurns) {
    options.push({
      value: "burns",
      label: burnCount > 0 ? `Burns (${burnCount})` : "Burns",
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-6 items-center justify-end">
        <Toggle options={options} active={view} onChange={setView} />
      </div>
      {view === "owned" && (
        <NFTGrid nfts={ownedNfts} loadingList={loadingOwned} />
      )}
      {view === "minted" && (
        <NFTGrid nfts={mintedNfts} loadingList={loadingMinted} />
      )}
      {view === "burns" && <BurnedNFTsList address={address} />}
    </div>
  );
}
