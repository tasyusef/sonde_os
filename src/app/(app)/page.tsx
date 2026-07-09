import type { Metadata } from "next";
import DashboardHero from "@/components/home/DashboardHero";
import FeatureShowcase from "@/components/landing/FeatureShowcase";
import LandingCTA from "@/components/landing/LandingCTA";
import {
  getDexVolume7dChange,
  getNetworkGrowthStats,
} from "@/lib/analytics-queries";

export const metadata: Metadata = {
  title: { absolute: "Sonde — Real-time XRPL Analytics" },
  description:
    "Real-time intelligence, analytics, and portfolio tracking for the XRP Ledger. Smart-money rankings, AMM volume, network anomalies — accurate by default.",
  alternates: { canonical: "/" },
};

// Per-request rendering for the stats fetch. `revalidate = 60`
// previously cached the entire page for 60s — including any
// transient ClickHouse hiccup that returned null. A single CH miss
// poisoned the cache for a full minute and every user saw "—" until
// the next revalidation. `force-dynamic` makes each request render
// fresh; the underlying `getNetworkGrowthStats` keeps its own 30s
// in-memory LRU cache so we still only hit CH ~once per minute even
// at high traffic.
export const dynamic = "force-dynamic";

export default async function Home() {
  /* Parallel fetch — both calls hit ClickHouse. Either failing falls
     back to `null`, which the hero renders as a graceful "—"
     placeholder. All four stats are unified on a 7D window:
     getNetworkGrowthStats already returns 7d-vs-prior-7d deltas for
     traders/trustlines/transactions; getDexVolume7dChange is its
     volume sibling, computed the same way. */
  const [growth, dexVol] = await Promise.all([
    getNetworkGrowthStats("7d").catch(() => null),
    getDexVolume7dChange().catch(() => null),
  ]);

  // Pull a metric (current + changePercent) by label so we're resilient
  // to ordering changes inside `getNetworkGrowthStats`.
  const metricByLabel = (
    label: string,
  ): { current: number | null; changePercent: number | null } => {
    const m = growth?.metrics.find((g) => g.label === label);
    return {
      current: m ? m.current : null,
      changePercent: m ? m.changePercent : null,
    };
  };

  const activeWallets = metricByLabel("Active Traders");
  const trustLines = metricByLabel("Trust Lines");
  const transactions = metricByLabel("Transactions");

  return (
    <main id="main-content" className="min-h-screen">
      <DashboardHero
        activeWallets={activeWallets.current}
        activeWalletsChange={activeWallets.changePercent}
        trustLines={trustLines.current}
        trustLinesChange={trustLines.changePercent}
        txVolume={transactions.current}
        txVolumeChange={transactions.changePercent}
        dexVolume7dXrp={dexVol?.current ?? null}
        dexVolume7dChange={dexVol?.changePercent ?? null}
      />
      <FeatureShowcase />
      <LandingCTA />
    </main>
  );
}
