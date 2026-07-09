"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { HOVER_SCALE, SPRING, TAP_SCALE } from "@/lib/motion";

/**
 * Layout shell for the collection detail page's content section
 * (below the hero). Same pattern as portfolio + account pages:
 *
 *   Desktop (lg+):
 *     `[3fr tabs] [2fr Insights sidebar]` grid. Sidebar is sticky
 *     in the right column.
 *
 *   Mobile (< lg):
 *     Tabs render full-width. The Insights sidebar is hidden in
 *     normal flow and surfaced via a fixed bottom-right "Insights"
 *     FAB that opens a bottom-sheet modal containing the same
 *     sidebar content.
 *
 * `tabs` and `sidebar` are passed as React-node slots so the page
 * can server-render their data once. The sidebar appears in two
 * physical DOM locations on mobile (the hidden grid slot + the
 * modal). Acceptable cost — chart card SSR fetches all fan out in
 * parallel during the single page render pass.
 */
export default function CollectionLayout({
  tabs,
  sidebar,
}: {
  tabs: ReactNode;
  sidebar: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <div className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* Left column — tabbed content. Always visible. */}
        <div className="min-w-0">{tabs}</div>

        {/* Right column — Insights sidebar. Desktop-only; on mobile
             the FAB+modal below surfaces the same content. Sticky on
             lg+ so it follows the viewport down. */}
        <aside className="hidden min-w-0 lg:block lg:sticky lg:top-6">
          {sidebar}
        </aside>
      </div>

      {/* Mobile-only floating Insights button */}
      <motion.button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open Insights sidebar"
        whileHover={{ scale: HOVER_SCALE, transition: SPRING.snap }}
        whileTap={{ scale: TAP_SCALE, transition: SPRING.pop }}
        // FAB row: sits to the LEFT of the global Search FAB on
        // sub-md viewports (`--fab-page-right`), then returns to
        // `bottom-5 right-4` from md+ where the search FAB is gone,
        // until it disappears at lg+.
        className="fixed bottom-[var(--fab-page-bottom)] right-[var(--fab-page-right)] z-40 inline-flex h-12 items-center gap-2 rounded-full bg-brand px-4 font-mono text-label font-semibold uppercase tracking-pill text-white shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 md:bottom-5 md:right-4 lg:hidden"
      >
        <ChartIcon />
        Insights
      </motion.button>

      {/* Mobile Insights modal — bottom-sheet, swipes up from the
           bottom. Same shape as the portfolio Tools modal. */}
      <AnimatePresence>
        {mobileOpen && (
          <MobileInsightsModal onClose={() => setMobileOpen(false)}>
            {sidebar}
          </MobileInsightsModal>
        )}
      </AnimatePresence>
    </>
  );
}

function MobileInsightsModal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Collection insights"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm lg:hidden"
    >
      <motion.div
        ref={dialogRef}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        // Framer Motion defaults `x`/`y` to spring physics — the `ease`
        // prop alone gets silently ignored for transforms unless we
        // explicitly set `type: "tween"`. That's what was producing the
        // spring overshoot Tim kept seeing even after we changed the
        // ease curve.
        transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-background"
      >
        <header className="flex items-center justify-between border-b border-elevated bg-surface px-4 py-3">
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            Insights
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
      </motion.div>
    </motion.div>
  );
}

function ChartIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 4 4 5-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
