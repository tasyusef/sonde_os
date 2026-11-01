import type { Route } from "./+types/nft";
import { pageMeta } from "@/lib/meta";
import RouteError from "@/components/shared/RouteError";
import NFTView from "@/components/nft/NFTView";

// Generic on purpose: the NFT loads in the browser, which sets the
// specific title once it arrives.
export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "NFT — XRPL",
    description: "XRPL NFT details: owner, issuer, metadata, open offers and transaction history.",
  });

export default function NFTDetailPage({ params }: Route.ComponentProps) {
  // Keyed so a new NFT starts from fresh state.
  return <NFTView key={params.id} id={params.id} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} fallback="Failed to load NFT" />;
}
