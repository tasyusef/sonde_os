"use client";

import { useState, Suspense, lazy } from "react";
import { motion } from "motion/react";
import useSWR from "swr";
import PageHero from "@/components/shared/PageHero";
import Toggle from "@/components/shared/Toggle";
import LeaderboardTable, { type LeaderboardRow } from "@/components/smart-money/LeaderboardTable";
import TipTour from "@/components/tips/TipTour";
import TipsButton from "@/components/tips/TipsButton";
import type { TipStep } from "@/components/tips/types";
import { fetcher } from "@/lib/swr-config";
import { useTabSlug } from "@/hooks/useTabSlug";
import { cn } from "@/lib/utils";

const SMART_MONEY_TIPS: TipStep[] = [
  {
    id: "intro",
    title: "Wallets that win.",
    body: "Every XRPL wallet gets a composite score from realised PnL, win rate, hold time, timing, and wash-trading checks. Highest scores at the top.",
    target: "[data-tip='sm-hero']",
    placement: "bottom",
  },
  {
    id: "tabs",
    title: "Leaderboard or feed.",
    body: "Leaderboard ranks scored wallets by edge. Feed is the live trade stream from the top-ranked wallets — every buy and sell as it hits the ledger.",
    target: "[data-tip='sm-tabs']",
    placement: "bottom",
  },
  {
    id: "period",
    title: "Pick a time window.",
    body: "The scoring window. 7D rewards recent edge, 30D smooths over a typical market cycle, 90D filters out streaks and shows persistent performers.",
    target: "[data-tip='sm-period']",
    placement: "left",
  },
];

const TradeFeed = lazy(() => import("@/components/smart-money/TradeFeed"));

/* ── Types ── */

type Period = "7d" | "30d" | "90d";
type TabId = "leaderboard" | "feed";

interface LeaderboardResponse {
  leaderboard: LeaderboardRow[];
  total?: number;
  limit?: number;
  offset?: number;
}

const PERIODS = [
  { value: "7d" as const, label: "7D" },
  { value: "30d" as const, label: "30D" },
  { value: "90d" as const, label: "90D" },
];

const TABS: { id: TabId; label: string }[] = [
  { id: "leaderboard", label: "Leaderboard" },
  { id: "feed", label: "Feed" },
];

/* ── Component ── */

export default function SmartMoneyPage() {
  const [activeTab, setActiveTab] = useTabSlug<TabId>("leaderboard");
  const [period, setPeriod] = useState<Period>("30d");

  const { data, isLoading } = useSWR<LeaderboardResponse>(
    `/api/smart-money/leaderboard?limit=50&period=${period}`,
    fetcher,
    { dedupingInterval: 30_000, revalidateOnFocus: false },
  );

  const rows = data?.leaderboard ?? [];
  const total = data?.total ?? rows.length;

  return (
    <div className="min-h-screen">
      <div data-tip="sm-hero">
        <PageHero
          title="Smart"
          accent="Money"
          subtitle="Discover XRPL wallets with proven trading edge."
          showDataWindow
        />
      </div>

      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        {/* Disclaimer + tips trigger row */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <p className="font-body text-cell text-muted">
            Informational only. Past performance does not guarantee future results.
          </p>
          <div className="shrink-0">
            <TipsButton pageId="/smart-money" />
          </div>
        </div>

        {/* Tab bar — relative + z-10 + isolate keeps the tablist above
             the leaderboard table's row-clickable ::after overlays, so a
             tab tap on mobile can't accidentally hit a row Link underneath
             after a scroll-release ghost tap. touch-manipulation also
             suppresses iOS's 300ms double-tap delay that amplifies that
             behavior. */}
        <div
          data-tip="sm-tabs"
          className="relative z-10 isolate mb-6 flex gap-1 border-b border-elevated overflow-x-auto"
          role="tablist"
          aria-label="Smart Money tabs"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              id={`sm-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`sm-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative shrink-0 px-2.5 py-2.5 sm:px-4 font-mono text-cell font-medium transition-colors -mb-px touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                activeTab === tab.id ? "text-brand" : "text-muted hover:text-primary",
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="sm-tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div
          id={`sm-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`sm-tab-${activeTab}`}
        >
          {activeTab === "leaderboard" && (
            <div className="rounded-2xl bg-surface shadow-card">
              {/* Header bar */}
              <div className="flex flex-col items-start gap-3 border-b border-elevated px-3 sm:px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="font-display text-label font-bold uppercase tracking-header text-brand">
                    Leaderboard
                  </span>
                  <p className="mt-0.5 font-mono text-cell font-medium text-muted">
                    {isLoading ? "Loading..." : `${total} scored wallets`}
                  </p>
                </div>
                <div data-tip="sm-period">
                  <Toggle options={PERIODS} active={period} onChange={setPeriod} />
                </div>
              </div>

              {/* Loading */}
              {isLoading && (
                <div className="space-y-0">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex gap-4 border-b border-elevated px-3 sm:px-4 py-3.5">
                      <div className="h-4 w-8 animate-pulse rounded bg-elevated" />
                      <div className="h-4 w-28 animate-pulse rounded bg-elevated" />
                      <div className="ml-auto h-4 w-12 animate-pulse rounded bg-elevated" />
                      <div className="h-4 w-16 animate-pulse rounded bg-elevated" />
                    </div>
                  ))}
                </div>
              )}

              {/* Table */}
              {!isLoading && (
                <div>
                  <LeaderboardTable rows={rows} />

                  {total > rows.length && (
                    <div className="flex justify-center border-t border-elevated px-3 sm:px-4 py-4">
                      <p className="font-mono text-cell text-muted">
                        Showing {rows.length} of {total} wallets
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "feed" && (
            <Suspense
              fallback={
                <div className="h-64 animate-pulse rounded-2xl bg-elevated" role="status" aria-label="Loading feed" />
              }
            >
              <TradeFeed />
            </Suspense>
          )}
        </div>
      </main>
      <TipTour pageId="/smart-money" steps={SMART_MONEY_TIPS} />
    </div>
  );
}
