import { useSearchParams } from "react-router";
import type { Route } from "./+types/account";
import { pageMeta } from "@/lib/meta";
import RouteError from "@/components/shared/RouteError";
import AccountView from "@/components/account/AccountView";

// Generic on purpose: the account loads in the browser, which sets the
// specific title once it arrives.
export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Account — XRPL",
    description:
      "XRPL account on Sonde: live balance, transactions, trust lines, NFTs and AMM positions.",
  });

export default function AccountPage({ params }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const dt = searchParams.get("dt");
  const parsedDt = dt ? parseInt(dt, 10) : NaN;
  return (
    // Keyed so a new address starts from fresh state; a new `?dt=` keeps it.
    <AccountView
      key={params.address}
      address={params.address}
      destinationTag={Number.isNaN(parsedDt) ? null : parsedDt}
    />
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} fallback="Failed to load account" />;
}
