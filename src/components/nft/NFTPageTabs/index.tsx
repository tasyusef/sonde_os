"use client";

import { type ReactNode } from "react";
import Tabs from "@/components/shared/Tabs";
import { useTabSlug } from "@/hooks/useTabSlug";
import { NFTTradeVolumeChart, NFTXrpVolumeChart } from "@/components/network/NFTActivityChart";

type TabId = "explore" | "analytics";

const tabDefs: { id: TabId; label: string }[] = [
  { id: "explore", label: "Explore" },
  { id: "analytics", label: "Analytics" },
];

interface NFTPageTabsProps {
  exploreSlot: ReactNode;
  rankingsSlot: ReactNode;
}

export function NFTPageTabs({ exploreSlot, rankingsSlot }: NFTPageTabsProps) {
  const [activeTab, setActiveTab] = useTabSlug<TabId>("explore");

  return (
    <div>
      <Tabs
        tabs={tabDefs}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
        panelId="nft-tabpanel"
      />
      <div
        id="nft-tabpanel"
        className="mt-6"
        role="tabpanel"
        aria-labelledby={activeTab + "-tab"}
      >
        {activeTab === "explore" && exploreSlot}
        {activeTab === "analytics" && (
          <>
            <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <NFTTradeVolumeChart />
              <NFTXrpVolumeChart />
            </div>
            <div className="mt-6">
              {rankingsSlot}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default NFTPageTabs;
