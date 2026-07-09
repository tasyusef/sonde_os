"use client";

import { type ReactNode, useState } from "react";
import dynamic from "next/dynamic";
import Tabs from "@/components/shared/Tabs";
import Skeleton from "@/components/shared/Skeleton";
import ResponsiveSelect from "@/components/shared/ResponsiveSelect";
import { useTabSlug } from "@/hooks/useTabSlug";
import NetworkHealthBanner from "@/components/network/NetworkHealthBanner";
import NetworkStatsBar from "@/components/home/NetworkStatsBar";

import LiveLedgerFeed from "@/components/home/LiveLedgerFeed";
import RecentTransactions from "@/components/home/RecentTransactions";
import PriceChart from "@/components/home/PriceChart";
import LedgerPerformance from "@/components/network/LedgerPerformance";
import CorridorChart from "@/components/network/CorridorChart";
import TopTraders from "@/components/network/TopTraders";
import TopGainers24h from "@/components/network/TopGainers24h";
import TrustlineWinners24h from "@/components/network/TrustlineWinners24h";
import NetworkGrowthStats from "@/components/network/NetworkGrowthStats";
import TokenVelocityChart from "@/components/network/TokenVelocityChart";
import AnomalyFeed from "@/components/network/AnomalyFeed";
import TxTypeDistributionChart from "@/components/network/TxTypeDistributionChart";
import DexTVLTreemap from "@/components/network/DexTVLTreemap";
import TopTradingPairs from "@/components/tokens/TopTradingPairs";
import TokenTopVolume from "@/components/tokens/TokenTopVolume";
import NFTTopMarketplaces from "@/components/nft/NFTTopMarketplaces";
import NFTTopCollections from "@/components/nft/NFTTopCollections";
import Reveal from "@/components/shared/Reveal";
import type { NetworkStats, PriceData, RecentTx } from "@/types/live-data";
import type { ServerHealth, TxTypeDistribution } from "@/types/network";

// Recharts-using charts gated behind the Analytics tab. Lazy-loaded
// so the recharts bundle doesn't ship on the homepage's default
// Overview tab — recharts is the single largest client dep, and
// most visitors never click into Analytics.
const chartLoading = () => <Skeleton className="h-[400px] rounded-2xl" />;
const FeeBurnChart = dynamic(() => import("@/components/network/FeeBurnChart"), { ssr: false, loading: chartLoading });
const TxVolumeChart = dynamic(() => import("@/components/network/TxVolumeChart"), { ssr: false, loading: chartLoading });
const DexVolumeChart = dynamic(() => import("@/components/network/DexVolumeChart"), { ssr: false, loading: chartLoading });
const AMMFeeRevenue = dynamic(() => import("@/components/network/AMMFeeRevenue"), { ssr: false, loading: chartLoading });
const ActiveWalletsChart = dynamic(() => import("@/components/network/ActiveWalletsChart"), { ssr: false, loading: chartLoading });
const XRPSupplyChart = dynamic(() => import("@/components/network/XRPSupplyChart"), { ssr: false, loading: chartLoading });
const NFTTradeVolumeChart = dynamic(() => import("@/components/network/NFTActivityChart").then((m) => m.NFTTradeVolumeChart), { ssr: false, loading: chartLoading });
const NFTXrpVolumeChart = dynamic(() => import("@/components/network/NFTActivityChart").then((m) => m.NFTXrpVolumeChart), { ssr: false, loading: chartLoading });

type TabId = "overview" | "analytics" | "amendments";
type AnalyticsCategory = "all" | "network" | "xrp" | "dex" | "nft";

const tabDefs: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "analytics", label: "Analytics" },
  { id: "amendments", label: "Amendments" },
];

const categoryDefs: { value: AnalyticsCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "network", label: "Network" },
  { value: "xrp", label: "XRP" },
  { value: "dex", label: "DEX & AMM" },
  { value: "nft", label: "NFT" },
];

interface NetworkTabsProps {
  stats: NetworkStats | null;
  priceData: PriceData | null;
  recentTxs: RecentTx[];
  recentTxTotal: number;
  serverHealth: ServerHealth | null;
  txDistribution: TxTypeDistribution[];
  amendmentsSlot: ReactNode;
}

/**
 * Network page tab strip.
 *
 * Overview is the live-network-state surface — server health, ledger
 * stats, XRP price, the live ledger ticker, recent transactions,
 * recent network anomalies, and tx-type distribution. No tokens, no
 * NFT marketplaces, no DEX rankings — those live in Analytics.
 *
 * Analytics is everything that's a chart or a leaderboard, organized
 * into Network / XRP / DEX & AMM / NFT categories. Pre-2026-05-10
 * four "ranking" cards (TopTradingPairs, TokenTopVolume,
 * NFTTopMarketplaces, NFTTopCollections) plus DexTVLTreemap lived in
 * Overview via the `NetworkRankingsLoader` server component; they
 * relocated here as part of the simplification pass.
 */
export function NetworkTabs({
  stats,
  priceData,
  recentTxs,
  recentTxTotal,
  serverHealth,
  txDistribution,
  amendmentsSlot,
}: NetworkTabsProps) {
  // Top-level tab persists in the URL via `?tab=` so refresh /
  // share-link restores it. The analytics category pill stays as
  // local state — it's a sub-toggle within the Analytics tab, not a
  // page-level tab.
  const [activeTab, setActiveTab] = useTabSlug<TabId>("overview");
  const [category, setCategory] = useState<AnalyticsCategory>("all");

  const show = (cat: AnalyticsCategory) => category === "all" || category === cat;

  return (
    <div>
      <Tabs tabs={tabDefs} activeTab={activeTab} onChange={(id) => setActiveTab(id as TabId)} panelId="network-tabpanel" />
      <div id="network-tabpanel" className="mt-6" role="tabpanel" aria-labelledby={activeTab + "-tab"}>
        {activeTab === "overview" && (
          <>
            {/* NetworkStatsBar — single-card market overview matching
                 the account/SmartMoneyOverviewCard shape. Full-width
                 since the redesigned card has its own 3-col stats
                 strip and the previous 320px slot was too cramped
                 for the new layout. AnomalyFeed sits embedded at the
                 bottom of this card (rather than as a standalone
                 strip above it) — keeps the alert/status info inside
                 the market context. NetworkHealthBanner moved
                 underneath this card. */}
            {stats ? (
              <div className="mb-6">
                <NetworkStatsBar
                  initialStats={stats}
                  initialPriceData={priceData}
                  bottomSlot={<AnomalyFeed embedded />}
                />
              </div>
            ) : (
              <div
                className="mb-6 p-4 text-center"
                role="status"
                aria-label="Connecting to XRPL network"
              >
                <p className="font-body text-body text-muted">
                  Connecting to XRPL network...
                </p>
              </div>
            )}

            <div className="mb-6">
              <NetworkHealthBanner initialHealth={serverHealth} />
            </div>

            <div className="mb-6">
              <PriceChart />
            </div>

            {/* Live ledger feed — "what's the network doing right
                 now" beat after the headline market numbers. */}
            <Reveal>
              <LiveLedgerFeed horizontal />
            </Reveal>

            <Reveal>
              <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
                <RecentTransactions initialTxs={recentTxs} initialTotal={recentTxTotal} />
                <TxTypeDistributionChart initialDistribution={txDistribution} />
              </div>
            </Reveal>
          </>
        )}

        {activeTab === "analytics" && (
          <>
            <NetworkGrowthStats />

            {/* ── Category pills (Toggle on desktop, native select on
                mobile — 5 options + "DEX & AMM" at 9 chars overflows
                a 375px row) ── */}
            <div className="mt-4 w-fit" data-tip="analytics-category-filter">
              <ResponsiveSelect
                options={categoryDefs}
                active={category}
                onChange={setCategory}
                ariaLabel="Analytics category"
                desktopVariant="select"
              />
            </div>

            {/* ── NETWORK ACTIVITY ── */}
            {show("network") && (
              <>
                <h3 className="mb-4 mt-6 font-display text-tag font-medium uppercase tracking-header text-muted">
                  Network Activity
                </h3>
                <Reveal>
                  <ActiveWalletsChart />
                </Reveal>
                <Reveal>
                  <div className="mt-6">
                    <CorridorChart />
                  </div>
                </Reveal>
                <Reveal>
                  <div className="mt-6">
                    <TxVolumeChart />
                  </div>
                </Reveal>
                <Reveal>
                  <div className="mt-6">
                    <FeeBurnChart />
                  </div>
                </Reveal>
                <Reveal>
                  <div className="mt-6">
                    <LedgerPerformance />
                  </div>
                </Reveal>
              </>
            )}

            {/* ── XRP ECONOMICS ── */}
            {show("xrp") && (
              <>
                <h3 className="mb-4 mt-6 font-display text-tag font-medium uppercase tracking-header text-muted">
                  XRP Economics
                </h3>
                <Reveal>
                  <XRPSupplyChart />
                </Reveal>
              </>
            )}

            {/* ── DEX & AMM ── */}
            {show("dex") && (
              <>
                <h3 className="mb-4 mt-6 font-display text-tag font-medium uppercase tracking-header text-muted">
                  DEX &amp; AMM
                </h3>
                <Reveal>
                  <DexTVLTreemap />
                </Reveal>
                <Reveal>
                  <div className="mt-6">
                    <DexVolumeChart />
                  </div>
                </Reveal>
                <Reveal>
                  <div className="mt-6">
                    <AMMFeeRevenue />
                  </div>
                </Reveal>
                <Reveal>
                  <div className="mt-6">
                    <TokenVelocityChart />
                  </div>
                </Reveal>
                <Reveal>
                  <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
                    <TokenTopVolume />
                    <TopTradingPairs />
                  </div>
                </Reveal>
                {/* TopGainers + TrustlineWinners side by side — both
                     are "trending tokens" angles (% gain vs trustline
                     adds). TopDexPairs24h was dropped 2026-05-10 as
                     a duplicate of TopTradingPairs above. */}
                <Reveal>
                  <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
                    <TopGainers24h />
                    <TrustlineWinners24h />
                  </div>
                </Reveal>
                <Reveal>
                  <div className="mt-6">
                    <TopTraders />
                  </div>
                </Reveal>
              </>
            )}

            {/* ── NFT MARKET ── */}
            {show("nft") && (
              <>
                <h3 className="mb-4 mt-6 font-display text-tag font-medium uppercase tracking-header text-muted">
                  NFT Market
                </h3>
                <Reveal>
                  <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
                    <NFTTopMarketplaces />
                    <NFTTopCollections />
                  </div>
                </Reveal>
                <Reveal>
                  <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
                    <NFTTradeVolumeChart />
                    <NFTXrpVolumeChart />
                  </div>
                </Reveal>
              </>
            )}
          </>
        )}

        {activeTab === "amendments" && amendmentsSlot}
      </div>
    </div>
  );
}

export default NetworkTabs;
