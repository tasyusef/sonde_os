import type { Metadata } from "next";
import { Suspense } from "react";
import PageHero from "@/components/shared/PageHero";
import TokenPageTabs from "@/components/tokens/TokenPageTabs";
import TokenListLoader from "@/components/tokens/TokenListLoader";
import AMMListLoader from "@/components/tokens/AMMListLoader";
import Skeleton from "@/components/shared/Skeleton";
import TipTour from "@/components/tips/TipTour";
import TipsButton from "@/components/tips/TipsButton";
import type { TipStep } from "@/components/tips/types";
import { getSiteUrl } from "@/lib/site-url";

const MARKETS_TIPS: TipStep[] = [
  {
    id: "intro",
    title: "Every XRPL market.",
    body: "Tokens ranked by trading volume and adoption, AMM pools by TVL, plus aggregate DEX analytics — all built from validated XRPL trades, not third-party feeds.",
    target: "[data-tip='markets-hero']",
    placement: "bottom",
  },
  {
    id: "tabs",
    title: "Three views.",
    body: "Tokens is the ranked-list view, AMMs lists the top pools by liquidity, and DEX Analytics dives into network-wide volume, fee revenue, and movers.",
    target: "[data-tip='markets-tabs']",
    placement: "bottom",
  },
  {
    id: "search",
    title: "Search for a specific token.",
    body: "Filter the list by ticker or paste a token's currency code / issuer address to jump straight to its detail page.",
    target: "[data-tip='markets-search']",
    placement: "bottom",
  },
];

export const metadata: Metadata = {
  title: "Markets — XRPL Token Rankings & DEX Analytics",
  description:
    "Browse XRPL tokens ranked by market cap, DEX trade volume, AMM pool liquidity, fee revenue, top traders, OHLC price charts, and top holder distribution.",
  alternates: { canonical: "/markets" },
};

export const dynamic = "force-dynamic";

/* ——— Skeleton fallback for token list ———
 * Matches the loaded TokenSearch shape: header bar with section label +
 * count + filter input + 24H/7D toggle on top, then column-header row,
 * then rows, then the pagination footer. */
function TokenListSkeleton() {
  return (
    <div role="status" aria-label="Loading token data">
      <div className="rounded-2xl shadow-card bg-surface">
        {/* Card header bar */}
        <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-2">
            <Skeleton className="h-[12px] w-[90px]" />
            <Skeleton className="h-[10px] w-[80px]" />
          </div>
          <div className="flex w-full items-center gap-3 sm:w-auto">
            <Skeleton className="h-[28px] flex-1 rounded-full sm:w-56 sm:flex-none" />
            <Skeleton className="h-[28px] w-[80px] rounded-full" />
          </div>
        </div>
        <div className="space-y-0">
          {/* Table column-header row */}
          <div className="flex items-center gap-4 border-b border-elevated px-4 py-3">
            <Skeleton className="h-[10px] w-[40px]" />
            <Skeleton className="h-[10px] w-[100px]" />
            <Skeleton className="ml-auto h-[10px] w-[80px]" />
            <Skeleton className="h-[10px] w-[80px]" />
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-elevated px-4 py-3 last:border-b-0"
            >
              <Skeleton className="h-[12px] w-[24px]" />
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-[12px] w-[120px]" />
              <Skeleton className="ml-auto h-[12px] w-[80px]" />
              <Skeleton className="h-[12px] w-[80px]" />
            </div>
          ))}
        </div>
        <PaginationFooterSkeleton />
      </div>
    </div>
  );
}

/* ——— Skeleton fallback for AMM list ———
 * Matches the loaded AMMList structure: header bar with section label +
 * count + filter input on top, column-header row, rows, pagination
 * footer. */
function AMMListSkeleton() {
  return (
    <div role="status" aria-label="Loading AMM pool data">
      <div className="rounded-2xl shadow-card bg-surface">
        {/* Card header bar */}
        <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-2">
            <Skeleton className="h-[12px] w-[90px]" />
            <Skeleton className="h-[10px] w-[60px]" />
          </div>
          <Skeleton className="h-[28px] w-full rounded-full sm:w-56" />
        </div>
        <div className="space-y-0">
          {/* Table column-header row */}
          <div className="flex items-center gap-4 border-b border-elevated px-4 py-3">
            <Skeleton className="h-[10px] w-[40px]" />
            <Skeleton className="h-[10px] w-[100px]" />
            <Skeleton className="ml-auto h-[10px] w-[80px]" />
            <Skeleton className="h-[10px] w-[60px]" />
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-elevated px-4 py-3 last:border-b-0"
            >
              <Skeleton className="h-[12px] w-[24px]" />
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-[12px] w-[140px]" />
              <Skeleton className="ml-auto h-[12px] w-[80px]" />
              <Skeleton className="h-[12px] w-[60px]" />
            </div>
          ))}
        </div>
        <PaginationFooterSkeleton />
      </div>
    </div>
  );
}

/** Shared pagination-footer placeholder — page-size select on the left,
 *  range label + chevron pair on the right. Matches `<Pagination>`'s
 *  layout so the loaded state hydrates without a vertical jump. */
function PaginationFooterSkeleton() {
  return (
    <div className="flex flex-col items-start justify-between gap-3 border-t border-elevated px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2">
        <Skeleton className="h-[14px] w-[36px]" />
        <Skeleton className="h-[28px] w-[56px] rounded-lg" />
        <Skeleton className="h-[14px] w-[56px]" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-[14px] w-[80px]" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/* ——— Page ——— */

export default async function TokensPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const params = await searchParams;
  const siteUrl = getSiteUrl();
  const datasetJsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "XRPL Markets — Token Rankings, DEX Volume, AMM TVL",
    description:
      "Live rankings for every issued token on the XRP Ledger: 24h / 7d / 30d / 90d / all-time DEX trade volume, holder counts, trustline growth, AMM pool TVL, fee revenue, top traders, and OHLC price history. Derived from every validated XRPL DEX trade and trustline event since June 2025.",
    url: `${siteUrl}/markets`,
    keywords: [
      "XRPL", "XRP Ledger", "tokens", "DEX", "AMM", "trade volume",
      "trustlines", "OHLC", "holders", "liquidity", "RLUSD", "SOLO",
    ],
    creator: { "@type": "Organization", name: "Sonde", url: siteUrl },
    license: "https://sondelab.com/about",
    isAccessibleForFree: true,
    temporalCoverage: "2025-06/..",
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "text/html",
      contentUrl: `${siteUrl}/markets`,
    },
  };

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }}
      />
      <div data-tip="markets-hero">
        <PageHero
          title="Markets"
          accent="on the XRPL."
          subtitle="Token rankings, DEX volume, and liquidity"
          showDataWindow
        />
      </div>
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex justify-end">
          <TipsButton pageId="/markets" />
        </div>
        <div data-tip="markets-tabs">
          <TokenPageTabs
            listSlot={
              <Suspense fallback={<TokenListSkeleton />}>
                <TokenListLoader initialSearch={params.search} />
              </Suspense>
            }
            ammSlot={
              <Suspense fallback={<AMMListSkeleton />}>
                <AMMListLoader />
              </Suspense>
            }
          />
        </div>
      </main>
      <TipTour pageId="/markets" steps={MARKETS_TIPS} />
    </div>
  );
}
