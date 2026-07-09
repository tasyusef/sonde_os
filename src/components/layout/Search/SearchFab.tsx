"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { ICON_HOVER_SCALE, ICON_TAP_SCALE, SPRING } from "@/lib/motion";
import UnifiedSearch from "./UnifiedSearch";

/**
 * Mobile-only search FAB + overlay dialog.
 *
 * The FAB sits at `bottom-[var(--fab-search-bottom)] right-4` — it's
 * the base of the mobile FAB stack. Page-specific FABs (Insights /
 * Watch / Overview) position themselves at `var(--fab-page-bottom)`
 * so they sit above this one with a consistent 12px gap.
 *
 * The overlay mounts/unmounts based on `open` (no slide/fade
 * transition). We tried Tailwind's `transition-transform` + utility
 * toggling for the slide-in, but in dev builds the JIT-generated
 * `translate-y-*` utilities were getting stuck mid-state. Hard
 * mount-unmount keeps it reliable; can layer animation later via
 * Framer/CSS keyframes if needed.
 *
 * Hidden on the landing page (`/`) since that route already has a
 * hero search bar.
 */
export default function SearchFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const overlayRef = useFocusTrap<HTMLDivElement>(open);

  // Escape to close + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Close on route change — user just navigated, no point keeping the
  // overlay open. Uses the "derived from prop" pattern (compare prev
  // pathname during render) instead of `useEffect(setOpen)` so it
  // satisfies `react-hooks/set-state-in-effect`.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (open) setOpen(false);
  }

  return (
    <>
      {/* FAB trigger — mobile only. Uses the shared icon-button gesture
           springs (snap on hover, pop on tap) so the press squashes
           and the release overshoots past scale 1.0 — same micro-
           feel as every other interactive control. */}
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open search"
        aria-expanded={open}
        whileHover={{ scale: ICON_HOVER_SCALE, transition: SPRING.snap }}
        whileTap={{ scale: ICON_TAP_SCALE, transition: SPRING.pop }}
        className="fixed bottom-[var(--fab-search-bottom)] right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 md:hidden"
      >
        <Search size={22} aria-hidden="true" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop. Click dismisses; Escape + Close button also
                 work for keyboard a11y. Quick fade so it doesn't lag
                 behind the dialog's spring slide. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 bg-black/60 md:hidden"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />

            {/* Overlay dialog — slides down from above the mobile top
                 bar with the shared `SPRING.layout`. Framer animates
                 inline `y`/`opacity`/`scale` values directly, bypassing
                 the Tailwind v4 utility-translate path that earlier
                 got stuck mid-state in dev builds. Generous inner
                 padding (`p-5`) gives the stacked controls breathing
                 room. */}
            <motion.div
              ref={overlayRef}
              role="dialog"
              aria-modal="true"
              aria-label="Search"
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.96 }}
              transition={SPRING.layout}
              className="fixed inset-x-3 top-[76px] z-50 rounded-2xl bg-surface p-5 shadow-card md:hidden"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-label font-bold uppercase tracking-header text-brand">
                  Search
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close search"
                  className="-mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <UnifiedSearch
                variant="overlay"
                autoFocus
                onSubmit={() => setOpen(false)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
