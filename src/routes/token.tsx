import type { Route } from "./+types/token";
import { pageMeta } from "@/lib/meta";
import RouteError from "@/components/shared/RouteError";
import TokenView from "@/components/token/TokenView";

// Generic on purpose: the token loads in the browser, which sets the
// specific title once it arrives.
export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Token — XRPL",
    description: "An XRPL token: its price in its XRP pool, supply, issuer and settings.",
  });

export default function TokenPage({ params }: Route.ComponentProps) {
  // Keyed so a new token starts from fresh state.
  return <TokenView key={params.id} id={params.id} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} fallback="Failed to load token" />;
}
