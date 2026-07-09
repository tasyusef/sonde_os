"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { HOVER_SCALE, SPRING, TAP_SCALE } from "@/lib/motion";
import Tabs from "@/components/shared/Tabs";
import Skeleton from "@/components/shared/Skeleton";
import { useTabSlug } from "@/hooks/useTabSlug";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import PortfolioHero from "@/components/portfolio/PortfolioHero";
import TokensPanel from "@/components/portfolio/TokensPanel";
import DeFiPanel from "@/components/portfolio/DeFiPanel";
import NFTHoldings from "@/components/portfolio/NFTHoldings";
import ActivityPanel from "@/components/portfolio/ActivityPanel";
import SideToolsPanel from "@/components/portfolio/SideToolsPanel";
import PortfolioRefreshProvider from "@/components/portfolio/PortfolioRefreshProvider";
import { IntelligenceProvider } from "@/components/intel/IntelligenceContext";

// PortfolioChart and OverviewPanel both pull recharts (OverviewPanel
// transitively via Allocation/MonthlyReturns/RealizedPnL). Dynamic-
// importing them keeps the hero + tab strip fast and gates the chart
// bundle behind: (a) the chart actually rendering, (b) the user
// landing on the Overview tab. Visitors on Tokens/DeFi/NFTs/Activity
// don't pay the recharts cost at all.
const PortfolioChart = dynamic(
  () => import("@/components/portfolio/PortfolioChart"),
  { ssr: false, loading: () => <Skeleton className="h-[280px] rounded-2xl" /> },
);
const OverviewPanel = dynamic(
  () => import("@/components/portfolio/OverviewPanel"),
  { ssr: false, loading: () => <Skeleton className="h-[600px] rounded-2xl" /> },
);

const MAIN_TABS = [
  { id: "overview", label: "Overview" },
  { id: "tokens", label: "Tokens" },
  { id: "defi", label: "DeFi" },
  { id: "nfts", label: "NFTs" },
  { id: "activity", label: "Activity" },
];

export default function PortfolioDashboard({
  address,
}: {
  address: string;
}) {
  const [activeTab, setActiveTab] = useTabSlug("overview");
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  return (
    <IntelligenceProvider>
      <PortfolioRefreshProvider>
      <div className="flex flex-col gap-6">
        <PortfolioHero address={address} />
        <PortfolioChart />

        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          {/* Left column — main portfolio tabs */}
          <div className="min-w-0">
            <Tabs
              tabs={MAIN_TABS}
              activeTab={activeTab}
              onChange={setActiveTab}
              panelId="portfolio-tabpanel"
            />
            <div
              id="portfolio-tabpanel"
              role="tabpanel"
              aria-labelledby={`${activeTab}-tab`}
              className="pt-6"
            >
              {activeTab === "overview" && <OverviewPanel />}
              {activeTab === "tokens" && <TokensPanel />}
              {activeTab === "defi" && <DeFiPanel />}
              {activeTab === "nfts" && <NFTHoldings />}
              {activeTab === "activity" && <ActivityPanel />}
            </div>
          </div>

          {/* Right column — Tools & Query. Desktop-only; on mobile this
               sidebar would end up buried below the main tab content (way
               out of reach), so we swap to a modal triggered by a FAB. */}
          <div className="hidden min-w-0 lg:block">
            <div className="sticky top-6">
              <SideToolsPanel />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile-only floating "Tools" button */}
      <motion.button
        type="button"
        onClick={() => setMobileToolsOpen(true)}
        aria-label="Open tools and AI query"
        whileHover={{ scale: HOVER_SCALE, transition: SPRING.snap }}
        whileTap={{ scale: TAP_SCALE, transition: SPRING.pop }}
        // FAB row: sits to the LEFT of the global Search FAB on
        // sub-md viewports (`--fab-page-right`), then returns to
        // `bottom-5 right-4` from md+ where the search FAB is gone,
        // until it disappears at lg+.
        className="fixed bottom-[var(--fab-page-bottom)] right-[var(--fab-page-right)] z-40 inline-flex h-12 items-center gap-2 rounded-full bg-brand px-4 font-mono text-label font-semibold uppercase tracking-pill text-white shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 md:bottom-5 md:right-4 lg:hidden"
      >
        <SparklesIcon />
        Tools
      </motion.button>

      {/* Mobile tools modal */}
      <AnimatePresence>
        {mobileToolsOpen && (
          <MobileToolsModal onClose={() => setMobileToolsOpen(false)} />
        )}
      </AnimatePresence>
      </PortfolioRefreshProvider>
    </IntelligenceProvider>
  );
}

function MobileToolsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

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
      aria-label="Tools and AI query"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm lg:hidden"
    >
      <motion.div
        ref={dialogRef}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={SPRING.layout}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-card"
      >
        <header className="flex items-center justify-between border-b border-elevated px-4 py-3">
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            Tools
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <SideToolsPanel />
        </div>
      </motion.div>
    </motion.div>
  );
}

function SparklesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 L13.5 8.5 L19 10 L13.5 11.5 L12 17 L10.5 11.5 L5 10 L10.5 8.5 Z" />
      <path d="M19 15 L19.8 17.2 L22 18 L19.8 18.8 L19 21 L18.2 18.8 L16 18 L18.2 17.2 Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
