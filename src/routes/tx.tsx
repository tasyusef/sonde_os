import type { Route } from "./+types/tx";
import { pageMeta } from "@/lib/meta";
import RouteError from "@/components/shared/RouteError";
import TransactionView from "@/components/tx/TransactionView";

// Generic on purpose: the tx loads in the browser, which sets the
// specific title once it arrives.
export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Transaction — XRPL",
    description:
      "XRPL transaction details: type, accounts, amount, fees, ledger index and the full meta breakdown.",
  });

export default function TransactionPage({ params }: Route.ComponentProps) {
  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        {/* Keyed so a new hash starts from fresh state. */}
        <TransactionView key={params.hash} hash={params.hash} />
      </main>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} fallback="Failed to load transaction" />;
}
