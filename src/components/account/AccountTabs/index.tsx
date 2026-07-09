"use client";

import Tabs from "@/components/shared/Tabs";
import Skeleton from "@/components/shared/Skeleton";
import { useTabSlug } from "@/hooks/useTabSlug";
import TransactionsTab from "@/components/account/TransactionsTab";
import NFTsTab from "@/components/account/NFTsTab";
import OffersTab from "@/components/account/OffersTab";
import PositionsTab from "@/components/account/PositionsTab";
import ProfileTab from "@/components/account/ProfileTab";
import IssuedTokens from "@/components/account/IssuedTokens";
import { countAccountBurns } from "@/components/account/BurnedNFTsList";
import { useAccountCounts } from "@/hooks/useAccountCounts";
import { useAccountNfts } from "@/hooks/useAccountNfts";
import type { ChipValue } from "@/components/account/DateRangeChips";
import type { AccountTxResult, AccountSettings } from "@/types/xrpl";
import type {
  AncestryData,
  InitialAccountHistory,
} from "@/hooks/useAccountData";

// "Positions" holds Tokens / Trust Lines / Escrows / Channels / MPTokens
// (sub-views picked inside PositionsTab). "Offers" is its own top-level
// tab now, split into Outgoing (DEX offers this account placed) and
// Incoming (NFT buy offers received + Checks targeting this account).
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
  loading = false,
  transactions,
  xrpBalance,
  xrpPrice,
  accountSettings,
  initialAncestry,
  issuedTokens,
  filterDestinationTag,
  burnedTxCount,
  initialHistory,
  initialChipValue,
  initialCustomFrom,
  initialCustomTo,
}: {
  address: string;
  /** True while `useAccountData` is still fetching tx history. Reserved
   *  for tabs that legitimately need the legacy data flow (Issued tokens
   *  remains because it's gated on rippled obligations resolving). */
  loading?: boolean;
  transactions: AccountTxResult["transactions"];
  xrpBalance: string;
  xrpPrice: number;
  accountSettings: AccountSettings;
  /** Server-rendered ancestry from `initialHistory.ancestry`. Threaded
   *  through to ProfileTab so its `useAccountAncestry` hook can skip the
   *  rippled fallback when CH already has the data. `null` falls
   *  through to the rippled call inside the hook. */
  initialAncestry: AncestryData | null;
  /** Tokens this account has issued — keyed by raw XRPL currency code, value
   *  is the outstanding obligation as a decimal string. */
  issuedTokens: Record<string, string>;
  filterDestinationTag?: number | null;
  /** Ledger-side count of NFTs minted by this account that have been burned.
   *  Sourced from account_data.BurnedNFTokens — used to decide whether to
   *  show the Burns sub-view inside NFTs and as the denominator in its badge. */
  burnedTxCount?: number;
  /** Initial server-rendered tx slice. Threaded into TransactionsTab so
   *  the chip-filtered first paint reuses what the page already rendered
   *  with — no duplicate fetch on hydration. */
  initialHistory?: InitialAccountHistory | null;
  initialChipValue: ChipValue;
  initialCustomFrom: string;
  initialCustomTo: string;
}) {
  const [activeTab, setActiveTab] = useTabSlug("transactions");
  const { counts: lifetimeCounts } = useAccountCounts(address);
  // SWR-shared with NFTsTab — same key, one fetch. Drives the tab badge
  // count + the showBurns gate. NFTsTab calls this hook itself for its
  // grid; calling it here too is free (cached).
  const { nfts: liveNfts } = useAccountNfts(address);

  const accountBurnCount = countAccountBurns(
    transactions as unknown as Parameters<typeof countAccountBurns>[0],
    address,
  );

  const issuedTokenEntries = Object.entries(issuedTokens).filter(
    ([currency]) => !(currency.length === 40 && currency.startsWith("03")),
  );
  const issuedCount = issuedTokenEntries.length;

  // Outer tab counts:
  //   - transactions → lifetime PG counter (sub-500ms), tx-window fallback
  //   - nfts         → live count from useAccountNfts
  //   - issued       → issued tokens length
  //   - positions    → no count (multi-view tab; sub-views show their own)
  //   - profile      → no count (metadata)
  const liveTxCount =
    lifetimeCounts?.totalCount &&
    lifetimeCounts.totalCount > transactions.length
      ? lifetimeCounts.totalCount
      : transactions.length;
  const counts: Record<string, number | null> = {
    transactions: liveTxCount,
    nfts: liveNfts.length,
    issued: issuedCount,
    positions: null,
    offers: null,
    profile: null,
  };

  // NFT burns sub-view visible when the account has either initiated a
  // burn in the loaded tx window or minted NFTs that were later burned.
  const showBurns = accountBurnCount > 0 || (burnedTxCount ?? 0) > 0;
  // Issued only appears once we know it has content. Positions is now
  // always-visible because Tokens (its default sub-view) is non-empty
  // for every account (XRP balance).
  const showIssuedTab = !loading && issuedCount > 0;

  const tabs = tabDefs
    .filter((t) => t.id !== "issued" || showIssuedTab)
    .map((t) => {
      const count = counts[t.id];
      const showCount =
        t.id === "transactions" ? true : !loading && count != null && count > 0;
      return {
        ...t,
        label:
          showCount && count != null && count > 0
            ? `${t.label} (${count})`
            : t.label,
      };
    });

  return (
    <div>
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} panelId="account-tabpanel" />
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
          <TransactionsTab
            address={address}
            filterDestinationTag={filterDestinationTag}
            initialHistory={initialHistory}
            initialChipValue={initialChipValue}
            initialCustomFrom={initialCustomFrom}
            initialCustomTo={initialCustomTo}
          />
        )}
        {/* Issued is the only tab still gated behind the legacy
             monolithic `loading` flag — it depends on rippled
             gateway_balances resolving via `useIssuedTokens`. Positions,
             NFTs, and Profile own their own data + loading states. */}
        {activeTab === "issued" && loading && <PanelSkeleton />}
        {activeTab === "positions" && (
          <PositionsTab
            address={address}
            xrpBalance={xrpBalance}
            xrpPrice={xrpPrice}
          />
        )}
        {activeTab === "offers" && <OffersTab address={address} />}
        {activeTab === "nfts" && (
          <NFTsTab
            address={address}
            burnCount={accountBurnCount}
            showBurns={showBurns}
          />
        )}
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
          <ProfileTab
            address={address}
            accountSettings={accountSettings}
            initialAncestry={initialAncestry}
          />
        )}
      </div>
    </div>
  );
}

/** Per-tab skeleton shown while `useAccountData` fetches live ledger
 *  state. Same height as the populated tab (600px min) so switching
 *  tabs during the loading window doesn't reflow the page. */
function PanelSkeleton() {
  return (
    <div role="status" aria-label="Loading tab data" className="space-y-3">
      <div className="flex min-h-6 items-center justify-end" />
      <Skeleton className="h-[500px] rounded-2xl" />
    </div>
  );
}
