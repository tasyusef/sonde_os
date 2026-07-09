import type { Metadata } from "next";
import { Suspense } from "react";
import { HeroBackground } from "@/components/shared/PageHero";
import DataWindowBadge from "@/components/shared/DataWindowBadge";
import CopyButton from "@/components/shared/CopyButton";
import WatchButton from "@/components/account/WatchButton";
import AccountDataClient from "@/components/account/AccountDataClient";
import AccountMiniHeader from "@/components/account/AccountMiniHeader";
import AccountProfile from "@/components/account/AccountProfile";
import SmartMoneyBadges from "@/components/account/SmartMoneyBadges";
import MiniGraph from "@/components/account/MiniGraph";
import BehaviorTagChips from "@/components/account/BehaviorTagChips";
import TopCounterpartiesCard from "@/components/account/TopCounterpartiesCard";
import ActivityHeatmapCard from "@/components/account/ActivityHeatmapCard";
import Skeleton from "@/components/shared/Skeleton";
import { xrplClient } from "@/lib/xrpl-client";
import { getXrpPrice } from "@/lib/price-data";
import { getNetworkStats } from "@/lib/xrpl-data";
import {
  getAccountSynthesis,
  getAccountCounterparties,
  getAccountActivityHeatmap,
  getLiveBehaviorTags,
  getInitialAccountHistory,
} from "@/lib/clickhouse-queries";
import {
  chipStateFromSearchParams,
  resolveFromSearchParams,
} from "@/lib/account-tx-range";
import type { InitialAccountHistory } from "@/hooks/useAccountData";
import type { AccountInfoResponse } from "@/types/xrpl-responses";
import { getKnownName, getAccountType } from "@/lib/known-addresses";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const truncated = `${address.slice(0, 8)}...${address.slice(-6)}`;
  // Lift the known-name lookup into metadata so SERP titles + AI
  // citations read like "Bitstamp — XRPL Account" instead of
  // "Account rN9hPq...kF92". Falls back to truncated address when the
  // wallet isn't in the labelled set. Account type/flags need an
  // XRPL fetch to resolve, which would slow metadata generation —
  // intentionally left to the page body.
  const knownName = getKnownName(address);
  const label = knownName ?? truncated;
  return {
    title: `${label} — XRPL Account`,
    description:
      `${label} on the XRP Ledger. Live balance, transactions, trustlines, NFTs, AMM positions, and smart-money score on Sonde.`,
    alternates: { canonical: `/account/${address}` },
  };
}

export const dynamic = "force-dynamic";

/** Quick format check for classic r-addresses and X-addresses */
function isPlausibleAddress(s: string): boolean {
  if (XRPL_ADDRESS_RE.test(s)) return true;
  if (s.startsWith("X") && s.length === 46) return true;
  return false;
}

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ dt?: string; range?: string; from?: string; to?: string }>;
}) {
  const { address } = await params;
  const sp = await searchParams;
  const parsedDt = sp.dt ? parseInt(sp.dt, 10) : NaN;
  const destinationTag = Number.isNaN(parsedDt) ? null : parsedDt;

  // Date-range filter — chip strip on the tx tab. Server reads URL
  // chip state and threads it down so the client mounts with the same
  // active state (no hydration mismatch).
  const initialChipState = chipStateFromSearchParams({
    range: sp.range,
    from: sp.from,
    to: sp.to,
  });
  const resolvedRange = resolveFromSearchParams({
    range: sp.range,
    from: sp.from,
    to: sp.to,
  });

  // Tier 3: kick off the CH initial-history fetch but DO NOT await.
  // The promise is passed to AccountDataClient and consumed inside a
  // Suspense boundary there, so the page shell (hero, overview, sidebar)
  // streams immediately and the tx tab fills in when CH responds. On
  // failure resolves to null and useAccountData falls back to rippled
  // — same path as before this slot existed.
  //
  // Address validation is below in the try-block, but we kick this off
  // unconditionally; an invalid address makes CH return empty and the
  // promise resolves to null, never reaching the client tabs anyway
  // (we render the error branch instead of AccountDataClient).
  const initialHistoryPromise: Promise<InitialAccountHistory | null> =
    isPlausibleAddress(address)
      ? getInitialAccountHistory(address, resolvedRange).catch(() => null)
      : Promise.resolve(null);

  let accountInfo: AccountInfoResponse | null = null;
  let xrpPrice = 0;
  let baseReserve = 1;
  let ownerReserve = 0.2;
  const resolvedChipState = initialChipState;
  let error: string | null = null;

  if (!isPlausibleAddress(address)) {
    error = "Invalid XRPL address format";
  } else {
    try {
      // Gating block — only the calls required to render the page
      // SHELL (hero header, balance, reserves). Everything else is
      // streamed in via Suspense boundaries below so the user gets
      // visible content in <500ms instead of waiting for the slowest
      // ClickHouse query to finish.
      //
      // Pre-streaming, this Promise.all also awaited:
      //   - getMergedTxsForAccount  (CH, scales with tx count)
      //   - getAncestry             (CH)
      //   - getAccountCounterparties (CH)
      //   - getAccountActivityHeatmap (CH)
      //   - getAccountSynthesis + getLiveBehaviorTags (chained CH)
      // For 900K+-tx accounts the slowest of those was ~5–10s,
      // gating time-to-first-byte. Each is now its own <Suspense>
      // boundary in the JSX below.
      const [infoResult, priceData, networkStats] = await Promise.all([
        xrplClient.getAccountInfo(address),
        getXrpPrice().catch(() => null),
        getNetworkStats().catch(() => null),
      ]);
      accountInfo = infoResult;
      xrpPrice = priceData?.price ?? 0;
      if (networkStats) {
        baseReserve = networkStats.reserveBase;
        ownerReserve = networkStats.reserveIncrement;
      }
    } catch (e: unknown) {
      const err = e as { error_message?: string };
      error = err.error_message ?? "Account not found or not activated";
    }
  }

  const knownName = getKnownName(address);
  const accountType = accountInfo
    ? getAccountType(accountInfo.account_data.Flags, {
        regularKey: accountInfo.account_data.RegularKey,
        transferRate: accountInfo.account_data.TransferRate,
        domain: accountInfo.account_data.Domain,
        nfTokenMinter: accountInfo.account_data.NFTokenMinter,
      })
    : null;

  return (
    <div className="min-h-screen">
      {/* Mobile mini header — wallet name + watch button. Desktop gets
           the full hero below instead. */}
      <AccountMiniHeader address={address} knownName={knownName} />

      {/* Mobile-only behavior chips. Desktop renders these inside the
           hero alongside the badges. Without this block, mobile users
           never saw the synthesis-first product win — the chips are
           the headline visual signal of "what this account is." */}
      <div className="px-4 pt-2 lg:hidden empty:hidden">
        <Suspense fallback={null}>
          <BehaviorChipsSlot address={address} />
        </Suspense>
      </div>

      {/* Account hero — desktop only. Mobile uses the mini header above
           plus the address embedded in OverviewCard's header, so the big
           hero block is pure vertical waste there. */}
      <section className="relative hidden lg:block">
        <div className="pointer-events-none absolute inset-0 -top-18 overflow-hidden md:top-0 md:-left-18">
          <HeroBackground />
        </div>

        <div className="relative mx-auto max-w-container px-6 pt-4 pb-6 sm:pt-6 sm:pb-8">

          <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            {/* Left: title + subtitle */}
            <div className="shrink-0">
              <h1 className="font-display text-heading font-bold leading-[1.1] tracking-[-0.5px] text-primary sm:text-title">
                {knownName ?? "Account"}{" "}
                {!knownName && <span className="text-brand">Overview.</span>}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="font-body text-body text-secondary">
                  XRPL account details and activity
                </p>
                <DataWindowBadge />
              </div>
            </div>

            {/* Right: wallet address + badges */}
            <div className="flex flex-col items-start lg:items-end gap-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="break-all font-mono text-lg font-medium tracking-[-0.3px] text-brand sm:text-value">
                  {address}
                </span>
                <CopyButton text={address} />
                <WatchButton address={address} />
              </div>
              {/* Always render the badge wrapper. dt + accountType
                   render synchronously; behavior chips stream in via
                   Suspense once their CH queries resolve. If all three
                   end up empty the wrapper collapses via `empty:hidden`. */}
              <div className="flex items-center gap-2 flex-wrap empty:hidden">
                {destinationTag != null && !isNaN(destinationTag) && (
                  <span className="rounded-tag bg-brand/10 px-2 py-0.5 font-mono text-label font-semibold text-brand">
                    DT: {destinationTag}
                  </span>
                )}
                {accountType && accountType.category !== "regular" && (
                  <span className={`rounded-full px-2.5 py-0.5 font-mono text-label font-semibold uppercase ${
                    accountType.category === "amm"
                      ? "bg-tx-amm/10 text-tx-amm"
                      : accountType.category === "issuer"
                        ? "bg-tx-trust/10 text-tx-trust"
                        : "bg-tx-nft/10 text-tx-nft"
                  }`}>
                    {accountType.label}
                  </span>
                )}
                <Suspense fallback={null}>
                  <BehaviorChipsSlot address={address} />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Screen-reader heading — only renders on viewports below lg
           where the visible hero h1 is hidden. Without `lg:hidden` we
           had two h1 elements on desktop, which screen readers announce
           as a duplicate top-level landmark. */}
      <h1 className="sr-only lg:hidden">
        {knownName ?? "Account"} {address}
      </h1>

      <main id="main-content" className="mx-auto max-w-container px-4 py-4 sm:px-6 sm:py-8">
        {error ? (
          <div role="alert" className="rounded-2xl shadow-card bg-surface p-6 text-center sm:p-8">
            <p className="font-mono text-cell text-error">{error}</p>
            <p className="mt-2 break-all font-mono text-body text-muted">
              Address: {address}
            </p>
          </div>
        ) : accountInfo ? (
          <AccountDataClient
            address={address}
            xrpBalance={accountInfo.account_data.Balance}
            xrpPrice={xrpPrice}
            ownerCount={accountInfo.account_data.OwnerCount}
            baseReserve={baseReserve}
            ownerReserve={ownerReserve}
            filterDestinationTag={destinationTag}
            // Tier 3: streamed Suspense slot. Promise was kicked off
            // above, AccountDataClient consumes it inside a Suspense
            // boundary (overview/sidebar render eagerly; tabs +
            // history-status pill suspend until this resolves).
            initialHistoryPromise={initialHistoryPromise}
            initialChipValue={resolvedChipState.chip}
            initialCustomFrom={resolvedChipState.from}
            initialCustomTo={resolvedChipState.to}
            accountSettings={{
              flags: accountInfo.account_data.Flags,
              domain: accountInfo.account_data.Domain,
              regularKey: accountInfo.account_data.RegularKey,
              transferRate: accountInfo.account_data.TransferRate,
              tickSize: accountInfo.account_data.TickSize,
              nfTokenMinter: accountInfo.account_data.NFTokenMinter,
              mintedNFTokens: accountInfo.account_data.MintedNFTokens,
              burnedNFTokens: accountInfo.account_data.BurnedNFTokens,
            }}
            sidebar={
              <>
                <SmartMoneyBadges address={address} />
                <AccountProfile address={address} />
                <Suspense fallback={<HeatmapSkeleton />}>
                  <HeatmapSlot address={address} />
                </Suspense>
                <Suspense fallback={<CounterpartiesSkeleton />}>
                  <CounterpartiesSlot address={address} />
                </Suspense>
                <MiniGraph address={address} />
              </>
            }
          />
        ) : null}
      </main>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Streaming SSR slot components.
 *
 * Each is an async server component that does ONE ClickHouse fetch
 * and renders the corresponding card. Wrapped in <Suspense> in the
 * page above so the page shell renders immediately and these stream
 * in independently. This is the fix for time-to-first-content on
 * heavy accounts (e.g. 900K-tx wallets) where the previous monolithic
 * Promise.all gated TTFB on the slowest CH query.
 * ────────────────────────────────────────────────────────────────── */

async function BehaviorChipsSlot({ address }: { address: string }) {
  const synth = await getAccountSynthesis(address).catch(() => null);
  const tags = await getLiveBehaviorTags(address, { synth }).catch(() => []);
  if (tags.length === 0) return null;
  return <BehaviorTagChips tags={tags} />;
}

async function CounterpartiesSlot({ address }: { address: string }) {
  const counterparties = await getAccountCounterparties(address, {
    limit: 5,
  }).catch(() => []);
  return <TopCounterpartiesCard counterparties={counterparties} />;
}

async function HeatmapSlot({ address }: { address: string }) {
  const buckets = await getAccountActivityHeatmap(address, {
    days: 30,
  }).catch(() => []);
  return <ActivityHeatmapCard buckets={buckets} />;
}

/* ── Suspense fallbacks. Match the rendered shape so the layout
 *    doesn't shift when the real card streams in. ───────────────── */

function CounterpartiesSkeleton() {
  return (
    <section
      aria-label="Loading counterparties"
      className="rounded-2xl border border-elevated bg-surface p-4 shadow-card"
    >
      <Skeleton className="h-3 w-32 rounded" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full rounded" />
        ))}
      </div>
    </section>
  );
}

function HeatmapSkeleton() {
  return (
    <section
      aria-label="Loading activity heatmap"
      className="rounded-2xl border border-elevated bg-surface p-4 shadow-card"
    >
      <Skeleton className="h-3 w-32 rounded" />
      <Skeleton className="mt-4 h-24 w-full rounded-md" />
    </section>
  );
}
