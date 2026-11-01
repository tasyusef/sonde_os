import Tabs from "@/components/shared/Tabs";
import { useTabSlug } from "@/hooks/useTabSlug";
import LiveLedgerFeed from "@/components/home/LiveLedgerFeed";
import PriceChart from "@/components/price/PriceChart";
import NetworkFacts from "@/components/network/NetworkFacts";
import NetworkAmendments from "@/components/network/NetworkAmendments";
import Reveal from "@/components/shared/Reveal";
import StageRail from "@/components/shared/StageRail";

type TabId = "overview" | "amendments";

const tabDefs: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "amendments", label: "Amendments" },
];

/**
 * Network page tab strip.
 *
 * Overview is the live network on one screen, laid out like the detail
 * pages: the XRP price on the stage, market and server facts in the
 * rail, then the latest ledgers across the full width. From `lg` the
 * chart grows to fill the screen, down to its floor; a shorter window
 * scrolls. All of it but the price history comes from the relay
 * snapshot. Amendments lists protocol changes, read from the node in
 * the browser.
 */
export function NetworkTabs() {
  // Tab persists in the URL via `?tab=` so refresh / share-link restores it.
  const [activeTab, setActiveTab] = useTabSlug<TabId>("overview");

  return (
    <div className="flex flex-1 flex-col">
      <Tabs ariaLabel="Network sections" tabs={tabDefs} activeTab={activeTab} onChange={(id) => setActiveTab(id as TabId)} panelId="network-tabpanel" />
      <div id="network-tabpanel" className="mt-6 flex flex-1 flex-col" role="tabpanel" aria-labelledby={activeTab + "-tab"}>
        {activeTab === "overview" && (
          <>
            <StageRail fill className="lg:flex-1" stage={<PriceChart className="flex-1" />} rail={<NetworkFacts />} />

            <Reveal>
              <LiveLedgerFeed className="mt-16" />
            </Reveal>
          </>
        )}

        {activeTab === "amendments" && <NetworkAmendments />}
      </div>
    </div>
  );
}

export default NetworkTabs;
