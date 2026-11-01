import ListNotice from "@/components/shared/ListNotice";
import { useRetryRoute } from "@/hooks/useRetryRoute";

/**
 * Error boundary for a data page (tx, ledger, NFT, account): the
 * error's message, or `fallback`, and a retry, as a line on the page
 * ground.
 */
export default function RouteError({ error, fallback }: { error: unknown; fallback: string }) {
  const retry = useRetryRoute();
  const message = error instanceof Error && error.message ? error.message : fallback;

  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        <ListNotice tone="error" message={message} action={{ label: "Try again", onClick: retry }} />
      </main>
    </div>
  );
}
