import Link from "next/link";
import type { ReactNode } from "react";
import type { MarketingData } from "./types";
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
import { buildCardProps } from "@/components/marketing/cards/build-props";

/* ------------------------------------------------------------------ */
/*  Tile grid                                                          */
/* ------------------------------------------------------------------ */

interface CardTile {
  slug: string;
  label: string;
  component: ReactNode;
}

function Tile({ tile }: { tile: CardTile }) {
  return (
    <Link
      href={`/marketing/card/${tile.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-xl border border-elevated bg-background p-4 transition-all hover:border-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-display text-label font-bold uppercase tracking-header text-muted group-hover:text-brand">
          {tile.label}
        </span>
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-muted group-hover:text-brand"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </div>
      <div className="pointer-events-none relative h-40 overflow-hidden rounded-lg">
        <div className="origin-top-left scale-[0.6]">{tile.component}</div>
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent"
        />
      </div>
    </Link>
  );
}

export function MarketingCardGrid({ data }: { data: MarketingData | null }) {
  const {
    whaleProps, spotlightProps, biggestProps, anomalyProps,
    dexPairsProps, trustlineProps, accountsProps, feeBurnProps, corridorProps,
    liquidityPoolsProps, gainersProps,
  } = buildCardProps(data);

  const tiles: CardTile[] = [
    { slug: "tweet-whale", label: "Whale Flag", component: <WhaleFlagCard {...(whaleProps ?? {})} /> },
    { slug: "tweet-spotlight", label: "Smart Money Spotlight", component: <SmartMoneySpotlightCard {...(spotlightProps ?? {})} /> },
    { slug: "tweet-biggest", label: "Biggest Move", component: <BiggestMoveCard {...(biggestProps ?? {})} /> },
    { slug: "tweet-anomaly", label: "Anomaly Detection", component: <AnomalyCard {...(anomalyProps ?? {})} /> },
    { slug: "tweet-dex-pairs", label: "DEX Pair Leaderboard", component: <DexPairLeaderboardCard {...(dexPairsProps ?? {})} /> },
    { slug: "tweet-liquidity", label: "Top Liquidity Pools", component: <TopLiquidityPoolsCard {...(liquidityPoolsProps ?? {})} /> },
    { slug: "tweet-gainers", label: "Top Gainers 24H", component: <TopGainersCard {...(gainersProps ?? {})} /> },
    { slug: "tweet-trustlines", label: "Trustline Growth", component: <TrustlineWinnersCard {...(trustlineProps ?? {})} /> },
    { slug: "tweet-accounts", label: "Active Accounts", component: <ActiveAccountsCard {...(accountsProps ?? {})} /> },
    { slug: "tweet-burn", label: "Fee Burn", component: <FeeBurnCard {...(feeBurnProps ?? {})} /> },
    { slug: "tweet-corridors", label: "Payment Corridors", component: <PaymentCorridorCard {...(corridorProps ?? {})} /> },
  ];

  return (
    <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
      <p className="mb-1 font-display text-label font-bold uppercase tracking-header text-brand">
        Card Previews
      </p>
      <p className="mb-5 font-body text-ui text-secondary">
        Click a tile to open the fullscreen screenshot view in a new tab.
        {!data && (
          <span className="text-muted">
            {" "}Run Export below to populate cards with live data.
          </span>
        )}
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <Tile key={tile.slug} tile={tile} />
        ))}
      </div>
    </div>
  );
}

export default MarketingCardGrid;
