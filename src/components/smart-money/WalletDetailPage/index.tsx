"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import useSWR from "swr";
import PageHero from "@/components/shared/PageHero";
import CollapsibleCard from "@/components/shared/CollapsibleCard";
import SmartMoneyOverviewCard from "@/components/smart-money/SmartMoneyOverviewCard";
import FactorBreakdown from "@/components/smart-money/FactorBreakdown";
import TrackWalletButton from "@/components/smart-money/TrackWalletButton";
import WatchButton from "@/components/account/WatchButton";
import HoldingsTable from "@/components/smart-money/HoldingsTable";
import Skeleton from "@/components/shared/Skeleton";
import { buttonClasses } from "@/components/shared/Button";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import type { SmartMoneyDetail } from "@/lib/smart-money-data";

// ScoreHistoryChart pulls recharts. Sits below the score gauge + stat
// blocks, so dynamic-loading lets the above-the-fold content paint
// without waiting on the chart bundle.
const ScoreHistoryChart = dynamic(
  () => import("@/components/smart-money/ScoreHistoryChart"),
  { ssr: false, loading: () => <Skeleton className="h-[200px] rounded-2xl" /> },
);

/* ── Types ── */

// SmartMoneyDetail is the shared type — same shape returned by both
// the /api/smart-money/[address] route and the server-side pre-fetch
// in app/(app)/smart-money/[address]/page.tsx that seeds fallbackData.
type WalletScoreResponse = SmartMoneyDetail;

interface HistoryResponse {
  history: { compositeScore: number; scoredAt: string }[];
}

/* ── Helpers ── */

function formatAddress(addr: string): string {
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

/* ── Component ── */

export default function WalletDetailPage({
  address,
  initialDetail,
}: {
  address: string;
  /** Server-side pre-fetch from app/(app)/smart-money/[address]/page.tsx.
   *  Null when the wallet isn't scored or the address is malformed —
   *  in that case SWR runs as before and the existing 404 path renders. */
  initialDetail?: SmartMoneyDetail | null;
}) {
  const { data, isLoading, error } = useSWR<WalletScoreResponse>(
    CACHE_KEYS.smartMoneyDetail(address),
    fetcher,
    {
      dedupingInterval: 30_000,
      revalidateOnFocus: false,
      // When the server-side pre-fetch returned a row, hand it to SWR
      // so the score gauge + factor breakdown render at TTFB. SWR
      // still revalidates in the background. `null` (not scored) is
      // converted to undefined so the existing error path runs.
      fallbackData: initialDetail ?? undefined,
    },
  );

  const { data: historyData } = useSWR<HistoryResponse>(
    data ? CACHE_KEYS.smartMoneyHistory(address) : null, // Only fetch if score exists
    fetcher,
    { dedupingInterval: 60_000, revalidateOnFocus: false },
  );

  // Error states
  if (error && !isLoading) {
    const isUpgradeRequired = error.message?.includes("upgrade_required") || error.message?.includes("403");
    // Server attaches topAddress to the 403 payload so we can link
    // free users straight to the #1 wallet as a tangible teaser.
    let topAddress: string | null = null;
    if (isUpgradeRequired && error.message) {
      try {
        const parsed = JSON.parse(error.message) as { topAddress?: string };
        topAddress = parsed.topAddress ?? null;
      } catch {
        // fall through — no topAddress available
      }
    }

    return (
      <div className="min-h-screen">
        <PageHero title="Smart Money" accent="Detail" subtitle={formatAddress(address)} showDataWindow />
        <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
          {isUpgradeRequired ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-elevated bg-surface py-16 shadow-card">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-elevated bg-elevated">
                <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <p className="font-body text-ui text-secondary">
                Upgrade to <span className="font-semibold text-primary">Pro</span> to view this wallet&apos;s breakdown.
              </p>
              {topAddress && topAddress !== address && (
                <p className="font-body text-cell text-muted">
                  Try the free demo —{" "}
                  <Link href={`/smart-money/${topAddress}`} className="text-brand hover:underline">
                    #1 ranked wallet →
                  </Link>
                </p>
              )}
              <Link
                href="/pricing"
                className={buttonClasses({ variant: "primary", size: "md" })}
              >
                View Plans
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-elevated bg-surface py-16 shadow-card">
              <p className="font-body text-ui text-muted">This wallet hasn&apos;t been scored yet.</p>
              <p className="font-body text-cell text-muted">The scoring pipeline runs daily at 2am UTC.</p>
              <Link href={`/account/${address}`} className="mt-2 font-mono text-cell text-brand hover:underline">
                View on Explorer
              </Link>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <PageHero title="Smart Money" accent="Detail" subtitle={formatAddress(address)} showDataWindow />

      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8 space-y-6">
        {/* Disclaimer + entry-point buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-body text-cell text-muted">
            Informational only. Past performance does not guarantee future results.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <WatchButton address={address} />
            <TrackWalletButton address={address} />
          </div>
        </div>

        {/* Loading skeleton — matches the new overview-card height
             so the page doesn't shift when data lands. */}
        {isLoading && (
          <div className="space-y-6">
            <div className="h-52 animate-pulse rounded-2xl bg-elevated" />
            <div className="h-64 animate-pulse rounded-2xl bg-elevated" />
          </div>
        )}

        {data && (
          <>
            {/* Wash trading warning — kept as a separate alert so the
                 longer "exercise caution" message has room. The
                 overview card also surfaces a "Wash" pill in its
                 header for at-a-glance recognition. */}
            {data.washTradingFlag && (
              <div className="flex items-center gap-3 rounded-2xl border border-error/30 bg-error/5 px-4 py-3" role="alert">
                <span className="rounded-tag bg-error/10 px-1.5 py-0.5 font-mono text-tag font-semibold text-error">WASH</span>
                <p className="font-body text-cell text-error/80">
                  Wash trading activity detected on this wallet. Score has been penalized. Exercise caution.
                </p>
              </div>
            )}

            {/* Overview — same shape as account/OverviewCard:
                 status-dot label + address header, big score + PnL
                 sub, 3-col stats strip. Replaced the chunky
                 score-gauge + 5-stat block. */}
            <SmartMoneyOverviewCard
              address={address}
              compositeScore={data.compositeScore}
              totalPnlXrp={data.totalPnlXrp}
              winRate={data.winRate}
              sharpeRatio={data.sharpeRatio}
              totalTrades={data.totalTrades}
              tokensTraded={data.tokensTraded}
              washFlagged={data.washTradingFlag}
            />

            {/* Score Factors + Chart — two-column on desktop,
                 stacked on mobile. Each section is its own
                 collapsible card so the page is short by default
                 on phones; localStorage-backed expand state per
                 card. */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <CollapsibleCard
                title="Score Factors"
                storageKey="smart-money-factors"
              >
                <FactorBreakdown
                  profitability={data.profitabilityScore}
                  roi={data.roiScore}
                  winRate={data.winRateScore}
                  consistency={data.consistencyScore}
                  earlyBuyer={data.earlyBuyerScore}
                  smartExits={data.smartExitScore}
                  seasoning={data.seasoningScore}
                  penalties={data.penalties}
                />
              </CollapsibleCard>

              {historyData && (
                <CollapsibleCard
                  title="Score History"
                  storageKey="smart-money-history"
                >
                  <ScoreHistoryChart history={historyData.history} />
                </CollapsibleCard>
              )}
            </div>

            {/* Tokens Traded — held + closed positions, sorted by PnL desc */}
            <CollapsibleCard
              title="Tokens Traded"
              storageKey="smart-money-tokens"
            >
              <HoldingsTable address={address} />
            </CollapsibleCard>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/smart-money"
                className="rounded-lg bg-elevated px-4 py-2 font-mono text-cell font-medium text-primary transition-colors hover:bg-brand/10 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                Back to Leaderboard
              </Link>
              <Link
                href={`/account/${address}`}
                className="rounded-lg bg-elevated px-4 py-2 font-mono text-cell font-medium text-primary transition-colors hover:bg-brand/10 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                View on Explorer
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
