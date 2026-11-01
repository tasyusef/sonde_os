import type { Route } from "./+types/ledger";
import { pageMeta } from "@/lib/meta";
import RouteError from "@/components/shared/RouteError";
import LedgerView from "@/components/ledger/LedgerView";

// Generic on purpose: the ledger loads in the browser, which sets the
// specific title once it arrives.
export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Ledger — XRPL",
    description:
      "XRPL ledger details: close time, parent hash, total coins, transaction count and the full transaction list.",
  });

export default function LedgerPage({ params }: Route.ComponentProps) {
  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        {/* Keyed so a new ledger starts from fresh state. */}
        <LedgerView key={params.index} param={params.index} />
      </main>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} fallback="Failed to load ledger" />;
}
