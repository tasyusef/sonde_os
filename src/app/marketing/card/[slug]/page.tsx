import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  AccountPreview,
  CorridorPreview,
  DexAnalyticsPreview,
  LedgerFeedPreview,
  NetworkPreview,
  NFTPreview,
  PortfolioPreview,
  PricePreview,
  SmartMoneyPreview,
  TokenPreview,
  TransactionPreview,
} from "@/components/landing/FeaturePreview";
import ActiveAccountsCard from "@/components/marketing/cards/ActiveAccountsCard";
import AnomalyCard from "@/components/marketing/cards/AnomalyCard";
import BiggestMoveCard from "@/components/marketing/cards/BiggestMoveCard";
import DexPairLeaderboardCard from "@/components/marketing/cards/DexPairLeaderboardCard";
import FeeBurnCard from "@/components/marketing/cards/FeeBurnCard";
import PaymentCorridorCard from "@/components/marketing/cards/PaymentCorridorCard";
import SmartMoneySpotlightCard from "@/components/marketing/cards/SmartMoneySpotlightCard";
import TopGainersCard from "@/components/marketing/cards/TopGainersCard";
import TopLiquidityPoolsCard from "@/components/marketing/cards/TopLiquidityPoolsCard";
import TrustlineWinnersCard from "@/components/marketing/cards/TrustlineWinnersCard";
import WhaleFlagCard from "@/components/marketing/cards/WhaleFlagCard";
import { SondeMark, SondeWordmark } from "@/components/shared/SondeLogo";
import { fetchMarketingData } from "@/lib/marketing-data";
import { buildCardProps } from "@/components/marketing/cards/build-props";
import ForceDarkMode from "./ForceDarkMode";

const TREASURY_ADDRESS = process.env.SONDE_TREASURY_ADDRESS;

/**
 * Slugs that pull their data from the fetchMarketingData snapshot. Any slug
 * not in this list renders with placeholder/default props (feature-showcase
 * landing cards, etc.).
 */
const DATA_DRIVEN_SLUGS = new Set([
  "tweet-whale",
  "tweet-spotlight",
  "tweet-biggest",
  "tweet-anomaly",
  "tweet-dex-pairs",
  "tweet-liquidity",
  "tweet-gainers",
  "tweet-trustlines",
  "tweet-accounts",
  "tweet-burn",
  "tweet-corridors",
]);

/* ------------------------------------------------------------------ */
/*  Card registry                                                      */
/*                                                                     */
/*  Labels only — the component is chosen below based on slug and      */
/*  fetched card-prop data so we don't have to pre-render a no-data    */
/*  placeholder in the registry.                                       */
/* ------------------------------------------------------------------ */

const CARD_LABELS: Record<string, string> = {
  "tweet-whale": "Whale Flag",
  "tweet-spotlight": "Smart Money Spotlight",
  "tweet-biggest": "Biggest Move",
  "tweet-anomaly": "Anomaly Detection",
  "tweet-dex-pairs": "DEX Pair Leaderboard",
  "tweet-liquidity": "Top Liquidity Pools",
  "tweet-gainers": "Top Gainers 24H",
  "tweet-trustlines": "Trustline Growth",
  "tweet-accounts": "Active Accounts",
  "tweet-burn": "Fee Burn",
  "tweet-corridors": "Payment Corridors",
  // ── Feature showcase cards (landing-page mocks, hardcoded) ───────
  "smart-money": "Smart Money Leaderboard",
  portfolio: "Portfolio Intelligence",
  dex: "DEX Trade Volume",
  network: "Network Analytics",
  "ledger-feed": "Live Ledger Feed",
  account: "Account Explorer",
  token: "Token Analytics",
  nft: "NFT Gallery",
  corridor: "Payment Corridors",
  transaction: "Transaction Viewer",
  price: "Price Charts",
};

export const metadata: Metadata = {
  title: "Sonde — Marketing Card",
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return Object.keys(CARD_LABELS).map((slug) => ({ slug }));
}

/* ------------------------------------------------------------------ */
/*  Slug → card component (with live props when available)             */
/* ------------------------------------------------------------------ */

function renderTweetCard(
  slug: string,
  props: ReturnType<typeof buildCardProps>,
): ReactNode {
  switch (slug) {
    case "tweet-whale":
      return <WhaleFlagCard {...(props.whaleProps ?? {})} />;
    case "tweet-spotlight":
      return <SmartMoneySpotlightCard {...(props.spotlightProps ?? {})} />;
    case "tweet-biggest":
      return <BiggestMoveCard {...(props.biggestProps ?? {})} />;
    case "tweet-anomaly":
      return <AnomalyCard {...(props.anomalyProps ?? {})} />;
    case "tweet-dex-pairs":
      return <DexPairLeaderboardCard {...(props.dexPairsProps ?? {})} />;
    case "tweet-liquidity":
      return <TopLiquidityPoolsCard {...(props.liquidityPoolsProps ?? {})} />;
    case "tweet-gainers":
      return <TopGainersCard {...(props.gainersProps ?? {})} />;
    case "tweet-trustlines":
      return <TrustlineWinnersCard {...(props.trustlineProps ?? {})} />;
    case "tweet-accounts":
      return <ActiveAccountsCard {...(props.accountsProps ?? {})} />;
    case "tweet-burn":
      return <FeeBurnCard {...(props.feeBurnProps ?? {})} />;
    case "tweet-corridors":
      return <PaymentCorridorCard {...(props.corridorProps ?? {})} />;
    default:
      return null;
  }
}

function renderStaticCard(slug: string): ReactNode {
  switch (slug) {
    // ── Feature showcase cards (landing-page mocks, hardcoded) ───
    case "smart-money":
      return <SmartMoneyPreview />;
    case "portfolio":
      return <PortfolioPreview />;
    case "dex":
      return <DexAnalyticsPreview />;
    case "network":
      return <NetworkPreview />;
    case "ledger-feed":
      return <LedgerFeedPreview />;
    case "account":
      return <AccountPreview />;
    case "token":
      return <TokenPreview />;
    case "nft":
      return <NFTPreview />;
    case "corridor":
      return <CorridorPreview />;
    case "transaction":
      return <TransactionPreview />;
    case "price":
      return <PricePreview />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

/**
 * Marketing card screenshot target — fullscreen 16:9 canvas rendering a
 * single feature preview on a solid brand-colored backdrop with the Sonde
 * logo lockup in the bottom-left and the sondelab.com URL in the bottom-right.
 *
 * For tweet-* data-driven cards, data is fetched server-side via
 * fetchMarketingData() (admin-gated — treasury session required). Any
 * non-admin visitor sees the same card layout with placeholder DEFAULT_PROPS
 * so the route remains publicly previewable without leaking live data.
 *
 * Outside the `(app)` route group so no header, nav, or footer chrome from
 * the main layout. Inherits fonts and color tokens from the root layout.
 */
export default async function MarketingCardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const label = CARD_LABELS[slug];
  if (!label) notFound();

  // Admin gate: only the treasury session sees live snapshot data. Everyone
  // else renders the card with placeholder defaults (safe to keep the route
  // public for design review / screenshot practice without leaking prod data).
  const session = await getSession(await cookies());
  const isAdmin = !!(session?.address && session.address === TREASURY_ADDRESS);

  let renderedCard: ReactNode;

  if (DATA_DRIVEN_SLUGS.has(slug)) {
    // Live-data tweet cards — fetch only when admin is viewing.
    const data = isAdmin ? await fetchMarketingData() : null;
    const cardProps = buildCardProps(data);
    renderedCard = renderTweetCard(slug, cardProps);
  } else {
    renderedCard = renderStaticCard(slug);
  }

  if (!renderedCard) notFound();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand p-8">
      <ForceDarkMode />

      {/* 16:9 frame — centers card within a consistent aspect */}
      <div className="relative z-10 flex aspect-video w-full max-w-[1600px] items-center justify-center">
        <div className="w-full max-w-[520px] scale-[1.7] px-8 drop-shadow-[0_30px_60px_rgba(0,0,0,0.13)]">
          {renderedCard}
        </div>
      </div>

      {/* Bottom-left logo lockup */}
      <div className="absolute bottom-10 left-10 z-10 flex items-center gap-3">
        <SondeMark size={36} className="text-white" />
        <SondeWordmark height={26} className="text-white" />
        <span className="ml-4 font-display text-ui font-medium uppercase tracking-header text-white/70">
          / {label}
        </span>
      </div>

      {/* Bottom-right URL */}
      <div className="absolute bottom-10 right-10 z-10">
        <span className="font-display text-ui font-medium uppercase tracking-header text-white/70">
          sondelab.com
        </span>
      </div>
    </div>
  );
}
