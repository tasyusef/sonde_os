import type { Metadata } from "next";
import Link from "next/link";

/**
 * Research is temporarily offline (paused 2026-05-02 — until further notice).
 *
 * The previous implementation lives in ./PageClient.tsx and ./opengraph-image.tsx
 * (untouched). To restore: replace the body of this default export with
 *
 *   import IntelligencePage from "./PageClient";
 *   export default function Page() { return <IntelligencePage />; }
 *
 * and re-add the matching entries to:
 *   - src/components/layout/Sidebar/index.tsx (research nav links)
 *   - src/components/layout/Footer/index.tsx (explorerLinks)
 *   - src/app/sitemap.ts (sitemap entry)
 */

export const metadata: Metadata = {
  title: "Research — temporarily offline",
  description: "Sonde's research dashboard is temporarily unavailable.",
  alternates: { canonical: "/research" },
  robots: { index: false, follow: false },
};

export default function ResearchOfflinePage() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[60vh] max-w-container items-center justify-center px-4 py-12 sm:px-6 sm:py-16"
    >
      <div
        role="status"
        className="rounded-2xl shadow-card bg-surface p-8 text-center sm:p-12"
      >
        <p className="font-display text-tag uppercase tracking-header text-muted">
          Status
        </p>
        <h1 className="mt-2 font-display text-h2 text-primary sm:text-h1">
          Research is being rebuilt
        </h1>
        <p className="mx-auto mt-4 max-w-prose font-body text-body text-secondary">
          We&apos;re rebuilding Research with deeper investigative features —
          fund tracing, graph analysis, and behavioral profiling. Coming back
          stronger.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-6">
          <Link
            href="/"
            className="font-mono text-cell text-brand transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
          >
            ← Back to explorer
          </Link>
          <Link
            href="/portfolio"
            className="font-mono text-cell text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
          >
            Open portfolio
          </Link>
        </div>
      </div>
    </main>
  );
}
