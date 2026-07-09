"use client";

/**
 * AccountDataClient — top-level client container for the account page.
 * Renders OverviewCard + sidebar synchronously off server-known props
 * (balance, reserve, xrpPrice). The CH-backed initial tx history is
 * passed in as a Promise (Tier 3) and consumed inside two Suspense
 * boundaries:
 *
 *   - HistoryStatusFromPromise — the "as of ledger N — Live" pill above
 *     the grid; fallback is a small reserved-space placeholder so the
 *     grid below doesn't shift when the pill streams in.
 *   - AccountTabsArea — calls useAccountData with the resolved
 *     initialHistory, threads through to AccountTabsDisplay. Fallback
 *     is a tabs skeleton matching the rendered shape so the layout
 *     stays stable.
 *
 * AccountOverview (Total Value, Age) stays synchronous and uses
 * per-tab hooks for its data — it doesn't depend on the streamed
 * promise. Sidebar slots already have their own internal Suspense
 * (counterparties, heatmap streamed by the page).
 */

import {
  type ReactNode,
  Suspense,
  use,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { HOVER_SCALE, SPRING, TAP_SCALE } from "@/lib/motion";
import { Sparkles, X } from "lucide-react";
import {
  useAccountData,
  useIssuedTokens,
  type InitialAccountHistory,
} from "@/hooks/useAccountData";
import { useAccountNfts } from "@/hooks/useAccountNfts";
import { useAccountNftBids } from "@/hooks/useAccountNftBids";
import { useAccountObjects } from "@/hooks/useAccountObjects";
import { useAccountTrustLines } from "@/hooks/useAccountTrustLines";
import { useAccountAmmPositions } from "@/hooks/useAccountAmmPositions";
import { useAccountTokenPrices } from "@/hooks/useAccountTokenPrices";
import { useAccountAncestry } from "@/hooks/useAccountAncestry";
import AccountTabs from "@/components/account/AccountTabs";
import OverviewCard from "@/components/account/OverviewCard";
import HistoryStatus from "@/components/shared/HistoryStatus";
import LoadingDots from "@/components/shared/LoadingDots";
import Skeleton from "@/components/shared/Skeleton";
import type { ChipValue } from "@/components/account/DateRangeChips";
import { dropsToXrp } from "@/lib/xrpl-helpers";
import type { AccountSettings, AccountTxResult } from "@/types/xrpl";

interface Props {
  address: string;
  xrpBalance: string;
  xrpPrice: number;
  ownerCount: number;
  baseReserve?: number;
  ownerReserve?: number;
  filterDestinationTag?: number | null;
  /** Promise resolving to the CH-backed initial tx slice + ancestry.
   *  The page server-component kicks off the fetch and passes the
   *  Promise through; AccountDataClient consumes it inside Suspense
   *  boundaries so the page shell streams immediately. Resolves to
   *  `null` on CH error or when the address isn't valid — useAccountData
   *  falls back to rippled in that case. */
  initialHistoryPromise: Promise<InitialAccountHistory | null>;
  /** Date-range chip the server resolved from URL params (defaults to 30d).
   *  Threaded through to TransactionsTab so the client mounts with the
   *  same active state — no hydration mismatch. */
  initialChipValue?: ChipValue;
  initialCustomFrom?: string;
  initialCustomTo?: string;
  accountSettings: AccountSettings;
  /** Optional content rendered in the right sidebar next to stat cards. */
  sidebar?: ReactNode;
}

export default function AccountDataClient({
  address,
  xrpBalance,
  xrpPrice,
  filterDestinationTag,
  ownerCount,
  // Defaults match current XRPL mainnet (post-ReserveCut amendment).
  // Callers should pass live values from server_info.validated_ledger.
  baseReserve = 1,
  ownerReserve = 0.2,
  initialHistoryPromise,
  initialChipValue = "30d",
  initialCustomFrom = "",
  initialCustomTo = "",
  accountSettings,
  sidebar,
}: Props) {
  // Mobile-only intel panel state — same FAB + bottom-sheet pattern as
  // /portfolio. Below xl the sidebar is hidden inline; the FAB opens it
  // as a modal so heavy mobile pages don't push tx history out of view.
  const [intelOpen, setIntelOpen] = useState(false);

  // Server-known stats — render the overview card IMMEDIATELY without
  // waiting for any client-side fetch. Total Value + Age fold in via
  // per-tab hooks inside AccountOverview.
  const xrpBalanceDisplay = dropsToXrp(xrpBalance);
  const xrpAmount = parseFloat(xrpBalanceDisplay);
  const xrpValueUsd = xrpAmount * xrpPrice;
  const reserveXrp = baseReserve + ownerCount * ownerReserve;
  const availableXrp = Math.max(0, xrpAmount - reserveXrp);

  return (
    <>
      <Suspense fallback={<HistoryStatusPlaceholder />}>
        <HistoryStatusFromPromise promise={initialHistoryPromise} />
      </Suspense>

      {/* Two-column grid on xl+: main column (overview + tabs) + intel
           aside. Aside is capped at viewport height with internal scroll
           so the dashboard feel holds. Below xl the aside is hidden and
           the FAB+bottom-sheet below provides access. */}
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-0 xl:[&:has(aside>*)]:grid-cols-[1fr_500px]">
        <div className="min-w-0">
          <AccountOverview
            xrpBalanceDisplay={xrpBalanceDisplay}
            xrpValueUsd={xrpValueUsd}
            xrpPrice={xrpPrice}
            reserveXrp={reserveXrp}
            availableXrp={availableXrp}
            address={address}
          />

          <div className="mt-8">
            <Suspense fallback={<TabsSkeleton />}>
              <AccountTabsArea
                promise={initialHistoryPromise}
                address={address}
                xrpBalance={xrpBalance}
                xrpPrice={xrpPrice}
                accountSettings={accountSettings}
                filterDestinationTag={filterDestinationTag}
                initialChipValue={initialChipValue}
                initialCustomFrom={initialCustomFrom}
                initialCustomTo={initialCustomTo}
              />
            </Suspense>
          </div>
        </div>

        {sidebar && (
          <aside className="hidden space-y-6 min-w-0 xl:block xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto xl:pr-2">
            {sidebar}
          </aside>
        )}
      </div>

      {/* Mobile-only intel access — FAB + bottom-sheet modal. Mirrors
          the /portfolio tools-modal pattern. The aside above is hidden
          below xl, so the same widgets surface only on demand. */}
      {sidebar && (
        <>
          <motion.button
            type="button"
            onClick={() => setIntelOpen(true)}
            aria-label="Open intel panel"
            whileHover={{ scale: HOVER_SCALE, transition: SPRING.snap }}
            whileTap={{ scale: TAP_SCALE, transition: SPRING.pop }}
            // FAB row: on sub-md viewports the global Search FAB
            // occupies the bottom-right, so this Intel FAB sits on
            // the same row 12px to its LEFT via `--fab-page-right`.
            // At md+ (no search FAB) it returns to the normal
            // `bottom-5 right-4` baseline until it disappears at xl+.
            className="fixed bottom-[var(--fab-page-bottom)] right-[var(--fab-page-right)] z-40 inline-flex h-12 items-center gap-2 rounded-full bg-brand px-4 font-mono text-label font-semibold uppercase tracking-pill text-white shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 md:bottom-5 md:right-4 xl:hidden"
          >
            <Sparkles size={16} aria-hidden="true" />
            Intel
          </motion.button>

          <AnimatePresence>
            {intelOpen && (
              <IntelModal onClose={() => setIntelOpen(false)}>
                {sidebar}
              </IntelModal>
            )}
          </AnimatePresence>
        </>
      )}
    </>
  );
}

/** Streamed slot for the "as of ledger N — Live" pill. Uses the
 *  initial-history promise; renders only when CH actually had data
 *  (asOfLedger present), otherwise hides. The fallback below reserves
 *  approximate vertical space so the grid below doesn't shift when the
 *  resolved pill replaces it. */
function HistoryStatusFromPromise({
  promise,
}: {
  promise: Promise<InitialAccountHistory | null>;
}) {
  const initialHistory = use(promise);
  if (!initialHistory) {
    // No CH data — render an empty space matching the resolved pill's
    // vertical footprint so the grid below stays put.
    return <HistoryStatusPlaceholder />;
  }
  return (
    <div className="mt-6 mb-3">
      <HistoryStatus
        asOfLedger={initialHistory.asOfLedger}
        liveReady={true}
      />
    </div>
  );
}

/** Visible "Loading…" placeholder matching the resolved HistoryStatus
 *  pill's footprint AND tone. The original silent invisible spacer
 *  read as "page is broken" — same vertical reserve, but now it tells
 *  the user the data is in flight. */
function HistoryStatusPlaceholder() {
  return (
    <div className="mt-6 mb-3">
      <span
        className="inline-flex items-center gap-1.5 font-display text-tag uppercase tracking-header text-muted"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-muted motion-safe:animate-pulse"
        />
        Loading account data…
      </span>
    </div>
  );
}

/** Streamed slot for the entire tabs area. `use(promise)` suspends
 *  until the CH initial-history fetch resolves; once it does, we call
 *  useAccountData with the resolved value (skipping the rippled tx
 *  call when CH had data). useIssuedTokens is gated on the resolved
 *  data so it doesn't compete for WS slots while paginated tab hooks
 *  fan out. */
function AccountTabsArea({
  promise,
  address,
  xrpBalance,
  xrpPrice,
  accountSettings,
  filterDestinationTag,
  initialChipValue,
  initialCustomFrom,
  initialCustomTo,
}: {
  promise: Promise<InitialAccountHistory | null>;
  address: string;
  xrpBalance: string;
  xrpPrice: number;
  accountSettings: AccountSettings;
  filterDestinationTag?: number | null;
  initialChipValue: ChipValue;
  initialCustomFrom: string;
  initialCustomTo: string;
}) {
  const initialHistory = use(promise);

  const { data, error, isLoading } = useAccountData(
    address,
    initialHistory ?? undefined,
  );

  const { issuedTokens } = useIssuedTokens(address, !!data);

  if (error && !data) {
    return (
      <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-cell text-error">
          Failed to load account data
        </p>
        <p className="mt-2 font-mono text-tag text-muted">
          {(error as Error)?.message ?? "An unexpected error occurred"}
        </p>
      </div>
    );
  }

  return (
    <AccountTabsDisplay
      data={data ?? null}
      loading={isLoading || !data}
      address={address}
      xrpBalance={xrpBalance}
      xrpPrice={xrpPrice}
      accountSettings={accountSettings}
      filterDestinationTag={filterDestinationTag}
      issuedTokens={issuedTokens}
      initialHistory={initialHistory}
      initialChipValue={initialChipValue}
      initialCustomFrom={initialCustomFrom}
      initialCustomTo={initialCustomTo}
    />
  );
}

/** Suspense fallback for AccountTabsArea. Replaces two silent gray
 *  rectangles with a narrated, structured placeholder:
 *
 *    [tab-strip skeleton with chip-shaped buttons]
 *    ••• Loading transactions from ledger…
 *    [8 skeletal table rows]
 *
 *  The dots + status text tell the user something's happening; the
 *  table-row outlines convey "a list is coming" instead of "is the
 *  page broken?" Total height (~600px) matches the rendered shape so
 *  the layout doesn't shift when content streams in. */
function TabsSkeleton() {
  return (
    <div role="status" aria-label="Loading account data" className="space-y-3">
      {/* Tab strip — chip-shaped placeholders matching the real tab
           buttons' visual weight. */}
      <div className="flex items-center gap-2 overflow-hidden">
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>

      {/* Status row — narrate what's loading. Same dots + copy pattern
           as the tx-tab status row, applied to the outer load. */}
      <div
        className="flex items-center gap-2 px-1 font-mono text-tag text-muted"
        aria-live="polite"
      >
        <LoadingDots className="text-brand" />
        <span>Loading transactions from ledger…</span>
      </div>

      {/* Skeletal table rows — convey list shape so the user sees the
           tx-table eventually arriving, not a featureless gray slab. */}
      <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-elevated px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-4 w-16 shrink-0" />
            <Skeleton className="h-4 w-32 shrink-0" />
            <div className="ml-auto flex items-center gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="hidden h-4 w-24 sm:block" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Modal hosting the account intel widgets. Bottom-sheet on mobile,
 *  right-aligned drawer on desktop — same surface, viewport-appropriate
 *  motion. Tap-outside / Escape / X all close; body scroll is locked
 *  while open. */
function IntelModal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  // Pick layout once on mount based on viewport. Lazy useState
  // initializer reads matchMedia synchronously on first render — no
  // useEffect setState dance, no flash of mobile layout on a desktop
  // load. The modal only mounts after a user click, so this runs on
  // the client where matchMedia is available.
  const [isDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 1280px)").matches;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Account intel"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      className={`fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm ${isDesktop ? "items-stretch justify-end" : "items-end"}`}
    >
      <motion.div
        initial={isDesktop ? { x: "100%" } : { y: "100%" }}
        animate={isDesktop ? { x: 0 } : { y: 0 }}
        exit={isDesktop ? { x: "100%" } : { y: "100%" }}
        transition={SPRING.layout}
        onClick={(e) => e.stopPropagation()}
        className={`flex flex-col overflow-hidden bg-surface shadow-card ${
          isDesktop
            ? "h-full w-[520px] max-w-[90vw] rounded-l-2xl"
            : "max-h-[90vh] w-full rounded-t-2xl"
        }`}
      >
        <header className="flex items-center justify-between border-b border-elevated px-4 py-3">
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            Intel
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-6 overflow-auto p-4">
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  OverviewCard wrapper — renders sync from server-known props,
 *  computes Total Value + Age via per-tab hooks (SWR-shared with the
 *  Positions/NFTs sub-tabs).                                           */
/* ------------------------------------------------------------------ */

function AccountOverview({
  xrpBalanceDisplay,
  xrpValueUsd,
  xrpPrice,
  reserveXrp,
  availableXrp,
  address,
}: {
  xrpBalanceDisplay: string;
  xrpValueUsd: number;
  xrpPrice: number;
  reserveXrp: number;
  availableXrp: number;
  address: string;
}) {
  // All per-tab hooks SWR-share with their consumers in tabs/sub-tabs.
  // Calling them here costs zero extra fetches — same key, cached fan-out.
  // Trustlines come from the CH state mirror (commit 3bd5d4e); other
  // ledger objects (escrows/channels/MPT) still walk rippled.
  const objectsState = useAccountObjects(address);
  const trustLinesState = useAccountTrustLines(address);
  const ammState = useAccountAmmPositions(
    trustLinesState.lpTrustLines,
    address,
  );
  const pricesState = useAccountTokenPrices(
    trustLinesState.regularTrustLines,
    address,
  );
  // Ancestry from the rippled `forward:true limit:1` fallback. The
  // Tier-3 streamed `initialHistory.ancestry` is consumed by ProfileTab
  // via AccountTabsArea, not here — overhead of plumbing the promise
  // into AccountOverview just for the Age stat isn't worth the few
  // hundred ms saved (rippled fallback is fast).
  const ancestryState = useAccountAncestry(address, null);
  const { nfts: liveNfts } = useAccountNfts(address);
  const { highestBids: nftHighestBids } = useAccountNftBids(liveNfts);

  // Total value gates on the slowest leg (objects + trustlines +
  // chained dependents). While anything's loading we return null so the
  // OverviewCard renders its placeholder; once everything settles we
  // sum tokens + AMM + locked XRP (escrows/channels) + NFT bids on top
  // of XRP value.
  const totalValueUsd = useMemo(() => {
    if (
      objectsState.isLoading ||
      trustLinesState.isLoading ||
      pricesState.isLoading ||
      ammState.isLoading
    ) {
      return null;
    }
    const regularTrustLines = trustLinesState.regularTrustLines;
    const tokenPriceMap = pricesState.tokenPriceMap;
    const ammPositions = ammState.ammPositions;
    const escrows = objectsState.escrows;
    const channels = objectsState.channels;

    let tokenValueUsd = 0;
    for (const tl of regularTrustLines) {
      const isHigh = tl.HighLimit?.issuer === address;
      const issuer = isHigh ? tl.LowLimit?.issuer : tl.HighLimit?.issuer;
      if (!issuer) continue;
      const balance = parseFloat(tl.Balance?.value ?? "0");
      const displayBalance = isHigh ? -balance : balance;
      if (displayBalance <= 0 || !Number.isFinite(displayBalance)) continue;
      const info = tokenPriceMap[`${tl.Balance.currency}:${issuer}`];
      if (info?.metrics.price)
        tokenValueUsd += displayBalance * info.metrics.price * xrpPrice;
    }

    const assetUsd = (
      value: number,
      isXrp: boolean,
      currency: string,
      issuer: string,
    ) => {
      if (isXrp) return value * xrpPrice;
      const info = tokenPriceMap[`${currency}:${issuer}`];
      return info?.metrics.price ? value * info.metrics.price * xrpPrice : 0;
    };

    let ammValueUsd = 0;
    for (const pos of ammPositions) {
      const share = pos.sharePercent / 100;
      ammValueUsd +=
        assetUsd(
          pos.asset1Value * share,
          pos.asset1IsXrp,
          pos.asset1Currency,
          pos.asset1Issuer,
        ) +
        assetUsd(
          pos.asset2Value * share,
          pos.asset2IsXrp,
          pos.asset2Currency,
          pos.asset2Issuer,
        );
    }

    let lockedXrpValueUsd = 0;
    for (const esc of escrows) {
      const amount = (esc as { Amount?: string }).Amount;
      if (amount)
        lockedXrpValueUsd += parseFloat(dropsToXrp(amount)) * xrpPrice;
    }
    for (const ch of channels) {
      const account = (ch as { Account?: string }).Account;
      if (account !== address) continue;
      const total = (ch as { Amount?: string }).Amount;
      const claimed = (ch as { Balance?: string }).Balance;
      if (total) {
        const remaining = BigInt(total) - (claimed ? BigInt(claimed) : 0n);
        if (remaining > 0n)
          lockedXrpValueUsd +=
            parseFloat(dropsToXrp(remaining.toString())) * xrpPrice;
      }
    }

    const nftValueUsd =
      xrpPrice > 0
        ? Object.values(nftHighestBids).reduce((sum, xrp) => sum + xrp, 0) *
          xrpPrice
        : 0;

    return (
      xrpValueUsd +
      tokenValueUsd +
      ammValueUsd +
      lockedXrpValueUsd +
      nftValueUsd
    );
  }, [
    objectsState,
    trustLinesState,
    pricesState,
    ammState,
    xrpPrice,
    xrpValueUsd,
    address,
    nftHighestBids,
  ]);

  const [mountTime] = useState(() => Date.now());
  const activationDate = ancestryState.ancestry.activationDate ?? null;
  const ageLabel = useMemo(() => {
    if (activationDate == null) return null;
    const ms = (activationDate + 946684800) * 1000;
    const days = Math.max(0, Math.floor((mountTime - ms) / 86400000));
    return days >= 365 ? `${Math.floor(days / 365)}y` : `${days}d`;
  }, [activationDate, mountTime]);

  return (
    <OverviewCard
      address={address}
      xrpBalanceDisplay={xrpBalanceDisplay}
      xrpValueUsd={xrpValueUsd}
      xrpPrice={xrpPrice}
      totalValueUsd={totalValueUsd}
      reserveXrp={reserveXrp}
      availableXrp={availableXrp}
      activationDate={activationDate}
      ageLabel={ageLabel}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  AccountTabs wrapper — passes resolved data + initialHistory through */
/* ------------------------------------------------------------------ */

function AccountTabsDisplay({
  data,
  loading,
  address,
  xrpBalance,
  xrpPrice,
  accountSettings,
  filterDestinationTag,
  issuedTokens,
  initialHistory,
  initialChipValue,
  initialCustomFrom,
  initialCustomTo,
}: {
  /** Tx-history slice from `useAccountData`. `null` while in flight —
   *  TransactionsTab renders off `initialHistory` regardless. Used here
   *  only for `data?.transactions` passed to AccountTabs (countAccountBurns
   *  + count fallback). */
  data: { transactions: AccountTxResult["transactions"] } | null;
  loading: boolean;
  address: string;
  xrpBalance: string;
  xrpPrice: number;
  accountSettings: AccountSettings;
  filterDestinationTag?: number | null;
  issuedTokens: Record<string, string>;
  initialHistory: InitialAccountHistory | null;
  initialChipValue: ChipValue;
  initialCustomFrom: string;
  initialCustomTo: string;
}) {
  return (
    <AccountTabs
      address={address}
      loading={loading}
      transactions={data?.transactions ?? []}
      xrpBalance={xrpBalance}
      xrpPrice={xrpPrice}
      accountSettings={accountSettings}
      initialAncestry={initialHistory?.ancestry ?? null}
      issuedTokens={issuedTokens}
      filterDestinationTag={filterDestinationTag}
      burnedTxCount={accountSettings.burnedNFTokens}
      initialHistory={initialHistory}
      initialChipValue={initialChipValue}
      initialCustomFrom={initialCustomFrom}
      initialCustomTo={initialCustomTo}
    />
  );
}

export { AccountDataClient };
