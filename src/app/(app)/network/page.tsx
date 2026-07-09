import { Suspense } from "react";
import type { Metadata } from "next";
import PageHero from "@/components/shared/PageHero";
import NetworkTabs from "@/components/network/NetworkTabs";
import NetworkAmendmentsLoader from "@/components/network/NetworkAmendmentsLoader";
import TipTour from "@/components/tips/TipTour";
import TipsButton from "@/components/tips/TipsButton";
import type { TipStep } from "@/components/tips/types";
import { getSiteUrl } from "@/lib/site-url";

/* ── Tutorial steps for the /network page ──────────────────────
 * Sequential walkthrough that first-time visitors see. Anchors are
 * `data-tip="..."` attributes on the rendered DOM — the page below
 * sets them on a wrapper around PageHero and NetworkTabs so the
 * selectors stay stable regardless of which tab is currently
 * active. Re-trigger after dismissal via the TipsButton in the
 * page header. */
const NETWORK_TIPS: TipStep[] = [
  {
    id: "intro",
    title: "Network analytics, live.",
    body: "Every chart on this page updates in real time as new ledgers close — transaction volume, fee burn, payment corridors, anomaly detection. No daily-rollup lag.",
    target: "[data-tip='network-hero']",
    placement: "bottom",
  },
  {
    id: "tabs",
    title: "Switch dashboards.",
    body: "Three tabs: Overview for the live snapshot, Analytics for ranked charts and deep dives, and Amendments for upcoming protocol changes.",
    target: "[data-tip='network-tabs']",
    placement: "bottom",
  },
  {
    id: "analytics-filter",
    title: "Filter by category.",
    body: "On the Analytics tab, this dropdown narrows the charts to a single layer of the ledger — Network, XRP, DEX & AMM, or NFT.",
    target: "[data-tip='analytics-category-filter']",
    placement: "bottom",
  },
];
// `NetworkAmendmentsLoader` was previously wrapped in
// `nextDynamic(() => import(...))` to code-split the recharts bundle
// to the Amendments tab only. That worked for the chunk size but
// broke rendering: the loader is an async server component, and
// nextDynamic + Suspense around a server component caused both the
// SSR-streamed copy AND a client re-render to remain in the DOM
// under the same Suspense boundary, doubling every card and header.
// Recharts code-split still happens — AmendmentCard / AmendmentVoteChart
// are "use client" components, so Next's bundler ships them lazily
// when the tab actually mounts. Importing the loader normally is the
// right call.
import {
  getNetworkStats,
  getRecentTransactions,
  getServerHealth,
  getLedgerTxDistribution,
} from "@/lib/xrpl-data";
import { getXrpPrice } from "@/lib/price-data";
import type { RecentTx } from "@/types/live-data";

export const metadata: Metadata = {
  title: "Network Stats — XRP Ledger Live Monitoring",
  description:
    "Monitor the XRP Ledger network in real time — transaction throughput, fee burn rates, active wallets, amendment voting progress, node health, and payment corridor analysis.",
  alternates: { canonical: "/network" },
};

// NetworkTabs uses useTabSlug → useSearchParams() to hydrate the
// active tab from `?tab=`. Next 16 refuses to statically prerender
// pages that read URL query params without a Suspense boundary.
// `dynamic = "force-dynamic"` supersedes the previous `revalidate = 30`
// — the page is now per-request rather than ISR-cached, which matches
// the reality that the URL params drive what's rendered.
export const dynamic = "force-dynamic";

/* ── Skeleton fallback for Suspense boundary ── */

function AmendmentsSkeleton() {
  return (
    <div role="status" aria-label="Loading amendments">
      <div className="h-20 animate-pulse motion-reduce:animate-none rounded-2xl bg-elevated" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse motion-reduce:animate-none rounded-2xl bg-elevated" />
        ))}
      </div>
    </div>
  );
}

export default async function NetworkPage() {
  /* ── Tier 1: fast calls only — renders instantly ── */
  const [stats, priceData, recentTxs, serverHealth, txDistribution] =
    await Promise.all([
      getNetworkStats().catch(() => null),
      getXrpPrice().catch(() => null),
      getRecentTransactions().catch((): { txs: RecentTx[]; total: number; mints: never[] } => ({ txs: [], total: 0, mints: [] })),
      getServerHealth().catch(() => null),
      getLedgerTxDistribution().catch(() => ({ distribution: [], total: 0 })),
    ]);

  const siteUrl = getSiteUrl();
  const datasetJsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "XRPL Network Analytics — Sonde",
    description:
      "Hourly and daily aggregated metrics for the XRP Ledger including transaction volume, fee burn, active wallet counts, payment corridors, DEX volume, AMM revenue, NFT activity, and amendment voting. Derived from every validated XRPL transaction since June 2025.",
    url: `${siteUrl}/network`,
    keywords: [
      "XRPL", "XRP Ledger", "blockchain analytics", "transaction volume",
      "fee burn", "active wallets", "payment corridors", "DEX volume",
      "AMM", "NFT", "amendments",
    ],
    creator: { "@type": "Organization", name: "Sonde", url: siteUrl },
    license: "https://sondelab.com/about",
    isAccessibleForFree: true,
    temporalCoverage: "2025-06/..",
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "text/html",
      contentUrl: `${siteUrl}/network`,
    },
  };

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }}
      />
      {/* data-tip wrappers — anchors for the tutorial tour. Plain
           divs so they don't touch PageHero's render but the
           selectors below stay stable. */}
      <div data-tip="network-hero">
        <PageHero
          title="Network"
          accent="insights."
          subtitle="Real-time XRPL network analytics and metrics"
          showDataWindow
        />
      </div>
      <main
        id="main-content"
        className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8"
      >
        <div className="mb-4 flex justify-end">
          <TipsButton pageId="/network" />
        </div>
        <div data-tip="network-tabs">
          <NetworkTabs
            stats={stats}
            priceData={priceData}
            recentTxs={recentTxs.txs}
            recentTxTotal={recentTxs.total}
            serverHealth={serverHealth}
            txDistribution={txDistribution.distribution}
            amendmentsSlot={
              <Suspense fallback={<AmendmentsSkeleton />}>
                <NetworkAmendmentsLoader />
              </Suspense>
            }
          />
        </div>
      </main>
      <TipTour pageId="/network" steps={NETWORK_TIPS} />
    </div>
  );
}
