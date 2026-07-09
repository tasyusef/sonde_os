import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import PageHero from "@/components/shared/PageHero";
import NFTPageTabs from "@/components/nft/NFTPageTabs";
import NFTDiscoveryLoader from "@/components/nft/NFTDiscoveryLoader";
import NFTMintsLoader from "@/components/nft/NFTMintsLoader";
import NFTTradesLoader from "@/components/nft/NFTTradesLoader";
import NFTOwnerLoader from "@/components/nft/NFTOwnerLoader";
import Skeleton from "@/components/shared/Skeleton";
import TipTour from "@/components/tips/TipTour";
import TipsButton from "@/components/tips/TipsButton";
import type { TipStep } from "@/components/tips/types";
import { detectSearchType } from "@/lib/xrpl-helpers";
import { DiscoverySkeleton, MintsSkeleton } from "./skeletons";

const NFT_TIPS: TipStep[] = [
  {
    id: "intro",
    title: "Every XRPL NFT.",
    body: "Live mints, real trade volume by marketplace, recent sales, and a per-collection deep dive — backed by every NFT-related transaction on the ledger.",
    target: "[data-tip='nft-hero']",
    placement: "bottom",
  },
  {
    id: "tabs",
    title: "Explore or analyse.",
    body: "Explore shows recent mints and trades plus owner-address lookups. Analytics ranks top collections and marketplaces by real XRP volume.",
    target: "[data-tip='nft-tabs']",
    placement: "bottom",
  },
];

export const metadata: Metadata = {
  title: "NFT Gallery",
  description:
    "Explore XRPL NFTs — browse collections, track real trade volume by marketplace, view recent mints and sales, and look up any NFT by owner address or token ID.",
  alternates: { canonical: "/nft" },
};

export const dynamic = "force-dynamic";

/* ——— Skeleton fallbacks for each Suspense boundary ——— */

function TradesSkeleton() {
  return (
    <div className="rounded-2xl shadow-card bg-surface" role="status" aria-label="Loading recent trades">
      <div className="border-b border-elevated px-4 py-2.5">
        <Skeleton className="h-[10px] w-[100px]" />
      </div>
      <div className="space-y-0 px-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-elevated py-2.5 last:border-b-0">
            <Skeleton className="h-[12px] w-[90px]" />
            <Skeleton className="ml-auto h-[12px] w-[70px]" />
            <Skeleton className="hidden h-[12px] w-[90px] sm:block" />
            <Skeleton className="h-[10px] w-[50px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function IssuerSkeleton() {
  return (
    <div role="status" aria-label="Loading NFTs">
      <div className="mb-4 flex items-baseline gap-3">
        <Skeleton className="h-[10px] w-[90px]" />
        <Skeleton className="h-[12px] w-[200px]" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[3/4] w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/* ——— Page ——— */

export default async function NFTPage({
  searchParams,
}: {
  // `?issuer=` is the legacy param name (the URL said "issuer" but the
  // server has always treated it as the owner of the NFTs — XRPL's
  // account_nfts returns NFTs HELD by an account, not minted by it).
  // Accept both; redirect legacy to the canonical `?owner=` so links
  // out in the wild stay alive.
  searchParams: Promise<{ owner?: string; issuer?: string }>;
}) {
  const params = await searchParams;
  if (params.issuer && !params.owner) {
    redirect(`/nft?owner=${params.issuer}`);
  }
  const owner = params.owner;

  // Validate owner early so the error renders instantly (no Suspense needed)
  const ownerInvalid = owner && detectSearchType(owner) !== "account";

  const exploreContent = ownerInvalid ? (
    <div className="rounded-2xl shadow-card bg-surface p-8 text-center" role="alert">
      <p className="font-mono text-cell text-error">Invalid owner address</p>
    </div>
  ) : owner ? (
    <Suspense fallback={<IssuerSkeleton />}>
      <NFTOwnerLoader owner={owner} />
    </Suspense>
  ) : (
    <>
      <Suspense fallback={<MintsSkeleton />}>
        <NFTMintsLoader />
      </Suspense>

      <Suspense fallback={<TradesSkeleton />}>
        <NFTTradesLoader />
      </Suspense>
    </>
  );

  return (
    <div className="min-h-screen">
      {/* Instant — no data fetching needed. Search lookup moved to the
           global unified search (no more page-specific input). The
           `?owner=` deep link still routes to the owner-filtered view. */}
      <div data-tip="nft-hero">
        <PageHero
          title="NFT"
          accent="Explorer."
          subtitle="Browse XRPL NFT collections, marketplaces, and recent activity"
          showDataWindow
        />
      </div>

      <main
        id="main-content"
        className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8"
      >
        <div className="mb-4 flex justify-end">
          <TipsButton pageId="/nft" />
        </div>
        <div data-tip="nft-tabs">
          <NFTPageTabs
            exploreSlot={exploreContent}
            rankingsSlot={
              <Suspense fallback={<DiscoverySkeleton />}>
                <NFTDiscoveryLoader />
              </Suspense>
            }
          />
        </div>
      </main>
      <TipTour pageId="/nft" steps={NFT_TIPS} />
    </div>
  );
}
