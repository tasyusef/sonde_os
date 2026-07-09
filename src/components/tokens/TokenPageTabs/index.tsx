"use client";

import { type ReactNode } from "react";
import dynamic from "next/dynamic";
import Tabs from "@/components/shared/Tabs";
import Skeleton from "@/components/shared/Skeleton";
import { useTabSlug } from "@/hooks/useTabSlug";
import DexTVLOverview from "@/components/network/DexTVLOverview";
import TopTokenMovers from "@/components/network/TopTokenMovers";
import TopTraders from "@/components/network/TopTraders";
import TopGainers24h from "@/components/network/TopGainers24h";
import TopTradingPairs from "@/components/tokens/TopTradingPairs";
import TrustlineWinners24h from "@/components/network/TrustlineWinners24h";

// Recharts charts gated behind the DEX tab — default is the token list
// (no recharts), so /token loads without the chart bundle.
const chartLoading = () => <Skeleton className="h-[400px] rounded-2xl" />;
const DexVolumeChart = dynamic(() => import("@/components/network/DexVolumeChart"), { ssr: false, loading: chartLoading });
const AMMFeeRevenue = dynamic(() => import("@/components/network/AMMFeeRevenue"), { ssr: false, loading: chartLoading });

type TabId = "tokens" | "amms" | "dex";

const tabDefs: { id: TabId; label: string }[] = [
  { id: "tokens", label: "Tokens" },
  { id: "amms", label: "AMMs" },
  { id: "dex", label: "DEX Analytics" },
];

interface TokenPageTabsProps {
  listSlot: ReactNode;
  ammSlot: ReactNode;
}

export function TokenPageTabs({ listSlot, ammSlot }: TokenPageTabsProps) {
  const [activeTab, setActiveTab] = useTabSlug<TabId>("tokens");

  return (
    <div>
      <Tabs
        tabs={tabDefs}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
        panelId="token-tabpanel"
      />
      <div
        id="token-tabpanel"
        className="mt-6"
        role="tabpanel"
        aria-labelledby={activeTab + "-tab"}
      >
        {activeTab === "tokens" && listSlot}
        {activeTab === "amms" && ammSlot}
        {activeTab === "dex" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <DexVolumeChart />
              <DexTVLOverview />
            </div>
            <AMMFeeRevenue />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <TopGainers24h />
              <TopTradingPairs />
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <TrustlineWinners24h />
              <TopTokenMovers />
            </div>
            <TopTraders />
          </div>
        )}
      </div>
    </div>
  );
}

export default TokenPageTabs;
