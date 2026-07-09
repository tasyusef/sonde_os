import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getCollectionMeta } from "@/lib/db-queries";
import { detectSearchType } from "@/lib/xrpl-helpers";
import CollectionHero from "@/components/nft/CollectionHero";
import CollectionStats from "@/components/nft/CollectionStats";
import CollectionItems from "@/components/nft/CollectionItems";
import CollectionActivity from "@/components/nft/CollectionActivity";
import CollectionMints from "@/components/nft/CollectionMints";
import CollectionListings from "@/components/nft/CollectionListings";
import CollectionBurns from "@/components/nft/CollectionBurns";
import CollectionHolders from "@/components/nft/CollectionHolders";
import CollectionSalesScatter from "@/components/nft/CollectionSalesScatter";
import CollectionListingHistogram from "@/components/nft/CollectionListingHistogram";
import CollectionVolumeChart from "@/components/nft/CollectionVolumeChart";
import CollectionFloorListings from "@/components/nft/CollectionFloorListings";
import CollectionHoldersOverTime from "@/components/nft/CollectionHoldersOverTime";
import CollectionTabs from "@/components/nft/CollectionTabs";
import CollectionSidebar from "@/components/nft/CollectionSidebar";
import CollectionLayout from "@/components/nft/CollectionLayout";
import Skeleton from "@/components/shared/Skeleton";

export const dynamic = "force-dynamic";

interface RouteParams {
  issuer: string;
  taxon: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { issuer, taxon } = await params;
  const taxonNum = Number(taxon);
  if (detectSearchType(issuer) !== "account" || !Number.isFinite(taxonNum)) {
    return { title: "Collection — Sonde" };
  }

  const meta = await getCollectionMeta(issuer, taxonNum).catch(() => null);
  const title = meta?.name ?? `Collection #${taxon}`;
  return {
    title: `${title} — XRPL Collection`,
    description: meta?.description?.slice(0, 160) ?? `XRPL NFT collection by ${issuer}, taxon ${taxon}.`,
    alternates: { canonical: `/nft/collection/${issuer}/${taxon}` },
  };
}

/* ── Skeleton fallbacks ──────────────────────────────────────────── */

function TabSkeleton() {
  return (
    <div className="rounded-2xl bg-surface shadow-card" role="status" aria-label="Loading">
      <div className="space-y-0 px-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-elevated py-3 last:border-b-0">
            <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
            <Skeleton className="h-[12px] w-[120px]" />
            <Skeleton className="ml-auto h-[12px] w-[70px]" />
            <Skeleton className="h-[10px] w-[50px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartCardSkeleton({ label }: { label: string }) {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card"
      role="status"
      aria-label={`Loading ${label}`}
    >
      <div className="border-b border-elevated px-4 py-card-header">
        <Skeleton className="h-[10px] w-[60px]" />
      </div>
      <div className="px-3 py-4">
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

function HoldersSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card"
      role="status"
      aria-label="Loading holders"
    >
      <div className="border-b border-elevated px-4 py-card-header">
        <Skeleton className="h-[10px] w-[100px]" />
      </div>
      <div className="space-y-0 px-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-elevated py-3 last:border-b-0">
            <Skeleton className="h-[10px] w-6" />
            <Skeleton className="h-[12px] flex-1 max-w-[160px]" />
            <Skeleton className="h-[12px] w-[40px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { issuer, taxon } = await params;
  const taxonNum = Number(taxon);
  if (detectSearchType(issuer) !== "account" || !Number.isFinite(taxonNum)) {
    notFound();
  }

  // Hero metadata renders in the page shell (no Suspense) so the page
  // has a real title above the fold; it's a single PG round-trip and
  // doesn't block on CH. Tab content + holders each have their own
  // Suspense boundary so they stream independently.
  const meta = await getCollectionMeta(issuer, taxonNum).catch(() => null);

  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <CollectionHero
          meta={meta}
          issuer={issuer}
          taxon={taxonNum}
          bottomSlot={<CollectionStats issuer={issuer} taxon={taxonNum} />}
        />

        {/* Below the hero: tabs on the left, Insights sidebar on the
             right at lg+. On mobile the sidebar is surfaced via a
             persistent bottom-right FAB that opens a bottom-sheet
             modal — same pattern as the portfolio + account pages.
             3fr/2fr proportions. */}
        <CollectionLayout
          tabs={
            <CollectionTabs
              items={<CollectionItems issuer={issuer} taxon={taxonNum} />}
              trades={
                <Suspense fallback={<TabSkeleton />}>
                  <CollectionActivity issuer={issuer} taxon={taxonNum} />
                </Suspense>
              }
              mints={
                <Suspense fallback={<TabSkeleton />}>
                  <CollectionMints issuer={issuer} taxon={taxonNum} />
                </Suspense>
              }
              listings={
                <Suspense fallback={<TabSkeleton />}>
                  <CollectionListings issuer={issuer} taxon={taxonNum} />
                </Suspense>
              }
              burns={
                <Suspense fallback={<TabSkeleton />}>
                  <CollectionBurns issuer={issuer} taxon={taxonNum} />
                </Suspense>
              }
            />
          }
          sidebar={
            <CollectionSidebar>
              <Suspense fallback={<HoldersSkeleton />}>
                <CollectionHolders issuer={issuer} taxon={taxonNum} />
              </Suspense>
              <Suspense fallback={<ChartCardSkeleton label="Floor & Listings" />}>
                <CollectionFloorListings issuer={issuer} taxon={taxonNum} />
              </Suspense>
              <Suspense fallback={<ChartCardSkeleton label="Volume" />}>
                <CollectionVolumeChart issuer={issuer} taxon={taxonNum} />
              </Suspense>
              <Suspense fallback={<ChartCardSkeleton label="Sales" />}>
                <CollectionSalesScatter issuer={issuer} taxon={taxonNum} />
              </Suspense>
              <Suspense fallback={<ChartCardSkeleton label="Listings" />}>
                <CollectionListingHistogram issuer={issuer} taxon={taxonNum} />
              </Suspense>
              <Suspense fallback={<ChartCardSkeleton label="Holders Trend" />}>
                <CollectionHoldersOverTime issuer={issuer} taxon={taxonNum} />
              </Suspense>
            </CollectionSidebar>
          }
        />
      </main>
    </div>
  );
}
