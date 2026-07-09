"use client";

import { useEffect } from "react";
import Link from "next/link";
import logger from "@/lib/logger";

/** Route-level error boundary for /portfolio. Without this, async work
 *  in the server tree falls back to the root error UI which is generic. */
export default function PortfolioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error({ err: error, digest: error.digest }, "[/portfolio] route error");
  }, [error]);

  return (
    <main
      id="main-content"
      className="mx-auto flex max-w-container flex-col items-center justify-center px-4 py-24 text-center sm:px-6"
    >
      <div role="alert" className="rounded-2xl bg-surface p-8 shadow-card">
        <h1 className="font-display text-heading font-bold text-primary">
          Something went wrong loading your portfolio
        </h1>
        <p className="mt-2 font-body text-ui text-muted">
          We hit an error while preparing this page.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-brand px-4 py-2 font-mono text-cell font-medium text-white transition-colors hover:bg-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-elevated px-4 py-2 font-mono text-cell font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
