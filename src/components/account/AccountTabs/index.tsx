import Tabs from "@/components/shared/Tabs";
import Skeleton from "@/components/shared/Skeleton";
import { useTabSlug } from "@/hooks/useTabSlug";
import TransactionsTab from "@/components/account/TransactionsTab";
import NFTsTab from "@/components/account/NFTsTab";
import OffersTab from "@/components/account/OffersTab";
import PositionsTab from "@/components/account/PositionsTab";
import ProfileTab from "@/components/account/ProfileTab";
import IssuedTokens from "@/components/account/IssuedTokens";
import { useAccountNfts } from "@/hooks/useAccountNfts";
import { useIssuedTokens } from "@/hooks/useIssuedTokens";
import { isLpCurrency } from "@/lib/token-id";
import type { AccountSettings } from "@/types/xrpl";

// "Positions" stacks Tokens, Escrows, Channels, MPTokens and Trust Lines.
// "Offers" is its own tab, split into Outgoing (DEX offers this account
// placed) and Incoming (NFT buy offers received + Checks targeting it).
const tabDefs = [
  { id: "transactions", label: "Transactions" },
  { id: "positions", label: "Positions" },
  { id: "offers", label: "Offers" },
  { id: "nfts", label: "NFTs" },
  { id: "issued", label: "Issued" },
  { id: "profile", label: "Profile" },
];

export default function AccountTabs({
  address,
  xrpBalance,
  xrpPrice,
  accountSettings,
  filterDestinationTag,
  className,
}: {
  address: string;
  xrpBalance: string;
  xrpPrice: number;
  accountSettings: AccountSettings;
  filterDestinationTag?: number | null;
  className?: string;
}) {
  const [activeTab, setActiveTab] = useTabSlug("transactions");
  // Tokens this account has issued (`gateway_balances`): raw currency
  // code to the outstanding obligation, as a decimal string.
  const { issuedTokens, isLoading: loading } = useIssuedTokens(address);
  // SWR-shared with NFTsTab — same key, one fetch. Drives the tab badge
  // count; NFTsTab calls this hook itself for its grid (cached).
  const { nfts: liveNfts } = useAccountNfts(address);

  const issuedTokenEntries = Object.entries(issuedTokens).filter(
    ([currency]) => !isLpCurrency(currency),
  );
  const issuedCount = issuedTokenEntries.length;

  // Outer tab counts. Transactions has none: the loaded history is a
  // page, not a lifetime total. Positions, offers and profile are
  // multi-view tabs whose sub-views show their own counts.
  const counts: Record<string, number | null> = {
    transactions: null,
    nfts: liveNfts.length,
    issued: issuedCount,
    positions: null,
    offers: null,
    profile: null,
  };

  // Issued only appears once we know it has content. Positions is now
  // always-visible because Tokens (its default sub-view) is non-empty
  // for every account (XRP balance).
  const showIssuedTab = !loading && issuedCount > 0;

  const tabs = tabDefs
    .filter((t) => t.id !== "issued" || showIssuedTab)
    .map((t) => {
      const count = counts[t.id];
      const showCount = !loading && count != null && count > 0;
      return {
        ...t,
        label: showCount ? `${t.label} (${count.toLocaleString()})` : t.label,
      };
    });

  return (
    <div className={className}>
      <Tabs ariaLabel="Account sections" tabs={tabs} activeTab={activeTab} onChange={setActiveTab} panelId="account-tabpanel" />
      {/* Panel: fixed min-height + overflow-anchor disabled so switching
           between tabs with different content heights doesn't trigger
           browser scroll-anchoring jumps. */}
      <div
        id="account-tabpanel"
        className="mt-3 min-h-[600px] [overflow-anchor:none]"
        role="tabpanel"
        aria-labelledby={activeTab + "-tab"}
      >
        {activeTab === "transactions" && (
          <TransactionsTab address={address} filterDestinationTag={filterDestinationTag} />
        )}
        {/* Issued waits on `gateway_balances`; the other tabs own their
             data and loading states. */}
        {activeTab === "issued" && loading && <PanelSkeleton />}
        {activeTab === "positions" && (
          <PositionsTab
            address={address}
            xrpBalance={xrpBalance}
            xrpPrice={xrpPrice}
          />
        )}
        {activeTab === "offers" && <OffersTab address={address} />}
        {activeTab === "nfts" && <NFTsTab address={address} />}
        {activeTab === "issued" && !loading && (
          <div className="space-y-2">
            <div className="flex min-h-6 items-center justify-end" />
            <IssuedTokens
              issuer={address}
              tokens={issuedTokenEntries.map(([currency, outstanding]) => ({
                currency,
                outstanding,
              }))}
            />
          </div>
        )}
        {activeTab === "profile" && (
          <ProfileTab address={address} accountSettings={accountSettings} />
        )}
      </div>
    </div>
  );
}

/** Issued-tab skeleton while `gateway_balances` loads. Same height as
 *  the populated tab (600px min) so switching tabs doesn't reflow. */
function PanelSkeleton() {
  return (
    <div role="status" aria-label="Loading tab data" className="space-y-3">
      <div className="flex min-h-6 items-center justify-end" />
      <Skeleton className="h-[500px]" />
    </div>
  );
}
