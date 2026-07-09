import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import PageHero from "@/components/shared/PageHero";
import ConnectWallet from "@/components/portfolio/ConnectWallet";
import PortfolioDashboard from "@/components/portfolio/PortfolioDashboard";
import TipTour from "@/components/tips/TipTour";
import TipsButton from "@/components/tips/TipsButton";
import type { TipStep } from "@/components/tips/types";
import { MOCK_ADDRESS } from "@/lib/mock-portfolio";

const IS_MOCK = process.env.MOCK_PORTFOLIO === "true";

export const metadata: Metadata = {
  title: "Portfolio",
  description:
    "Connect your XRPL wallet to track portfolio value over time — XRP balance, token holdings, AMM positions, NFTs, escrows, and payment channels with historical charts.",
  alternates: { canonical: "/portfolio" },
};

// PortfolioDashboard uses useTabSlug → useSearchParams() to hydrate
// the active tab from `?tab=`. Next 16 refuses to statically prerender
// pages that read URL query params without a Suspense boundary.
// (Page is also session-gated so prerender wasn't buying us much
// caching in practice — most requests already hit the dynamic path.)
export const dynamic = "force-dynamic";

/* ── Tutorial tour ────────────────────────────────────────────
 * Two variants of the tour:
 *  - Connected: explains the dashboard's tabs and the snapshot
 *    history. Targets data-tip wrappers around dashboard sections
 *    (lives inside PortfolioDashboard).
 *  - Unconnected: walks the user through the connect flow.
 *
 * Both are defined as a single sequence; TipTour's findValidStep
 * skip logic picks the steps whose targets are currently in the
 * DOM (one set or the other), so each user only sees the tour that
 * matches their state. */
const PORTFOLIO_TIPS: TipStep[] = [
  {
    id: "intro",
    title: "Your XRPL portfolio.",
    body: "Connect any XRPL wallet to track holdings, AMM positions, NFTs, realised + unrealised PnL, and historical value — all read-only, no signing required.",
    target: "[data-tip='portfolio-hero']",
    placement: "bottom",
  },
  {
    id: "connect",
    title: "Read-only connection.",
    body: "We never request signing permissions. Connecting just tells the app which account to fetch — same data anyone can pull from the public ledger.",
    target: "[data-tip='portfolio-connect']",
    placement: "top",
  },
  {
    id: "dashboard",
    title: "Holdings, positions, PnL.",
    body: "Tabs cover token holdings, AMM positions, your NFT gallery, transaction activity, and historical value. Each is keyed to the connected address.",
    target: "[data-tip='portfolio-dashboard']",
    placement: "bottom",
  },
];

export default async function PortfolioPage() {
  let address: string | null = IS_MOCK ? MOCK_ADDRESS : null;

  if (!IS_MOCK) {
    try {
      const cookieStore = await cookies();
      const session = await getSession(cookieStore);
      address = session?.address ?? null;
    } catch {
      /* AUTH_SECRET not set — show connect UI */
    }
  }

  return (
    <div className="min-h-screen">
      <div data-tip="portfolio-hero">
        <PageHero
          title="Portfolio"
          accent=""
          subtitle="Connect your wallet to track holdings and performance"
          showDataWindow
        />
      </div>
      <main
        id="main-content"
        className="mx-auto max-w-container px-4 py-6 pb-12 sm:px-6 sm:py-8 sm:pb-16"
      >
        <div className="mb-4 flex justify-end">
          <TipsButton pageId="/portfolio" />
        </div>
        {address ? (
          <div data-tip="portfolio-dashboard">
            <PortfolioDashboard address={address} />
          </div>
        ) : (
          <div data-tip="portfolio-connect">
            <ConnectWallet />
          </div>
        )}
      </main>
      <TipTour pageId="/portfolio" steps={PORTFOLIO_TIPS} />
    </div>
  );
}
