"use client";

import Button from "@/components/shared/Button";

export default function TokensError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
          <p role="alert" className="font-mono text-cell text-error">
            {error.message || "Failed to load tokens"}
          </p>
          <Button
            onClick={reset}
            variant="outline"
            size="md"
            className="mt-4"
          >
            Try Again
          </Button>
        </div>
      </main>
    </div>
  );
}
