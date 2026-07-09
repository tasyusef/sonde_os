"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SPRING, slideDownVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

const tabBase =
  "relative whitespace-nowrap pb-3 font-display text-ui font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50";

const activeStyle = "text-primary";
const inactiveStyle = "text-muted hover:text-secondary";

export default function Tabs({
  tabs,
  activeTab,
  onChange,
  panelId,
}: {
  tabs: { id: string; label: string }[];
  activeTab: string;
  onChange: (id: string) => void;
  /** ID of the associated tabpanel element for aria-controls linkage */
  panelId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const underlineId = useId();

  // Measure how many tabs fit — ResizeObserver fires on initial observe
  useEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const calculate = () => {
      const containerWidth = container.clientWidth;
      const gap = 24; // gap-6 = 1.5rem = 24px
      const moreButtonWidth = 72; // approximate "More ▾" width

      const tabEls = measure.children;
      let usedWidth = 0;
      let fits = 0;

      for (let i = 0; i < tabEls.length; i++) {
        const tabWidth = (tabEls[i] as HTMLElement).offsetWidth;
        const extraGap = i > 0 ? gap : 0;
        const needed = usedWidth + extraGap + tabWidth;

        // Last tab fits without needing a More button
        if (i === tabEls.length - 1 && needed <= containerWidth) {
          fits = tabEls.length;
          break;
        }

        // Check if this tab + More button fits
        if (needed + gap + moreButtonWidth > containerWidth && i < tabEls.length - 1) {
          break;
        }

        usedWidth = needed;
        fits++;
      }

      setVisibleCount(Math.max(1, fits));
    };

    const ro = new ResizeObserver(calculate);
    ro.observe(container);
    return () => ro.disconnect();
  }, [tabs]);

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    if (!moreOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [moreOpen]);

  const visibleTabs = tabs.slice(0, visibleCount);
  const overflowTabs = tabs.slice(visibleCount);
  const hasOverflow = overflowTabs.length > 0;
  const overflowActive = overflowTabs.some((t) => t.id === activeTab);

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = tabs.length - 1;

    if (nextIndex !== null) {
      e.preventDefault();
      onChange(tabs[nextIndex].id);
      setMoreOpen(nextIndex >= visibleCount);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Hidden measurement row — renders all tabs offscreen to measure widths */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute flex h-0 gap-6 overflow-hidden"
      >
        {tabs.map((tab) => (
          <span key={tab.id} className={tabBase}>
            {tab.label}
          </span>
        ))}
      </div>

      {/* Visible tabs */}
      <div role="tablist" className="flex gap-6 border-b border-elevated">
        {visibleTabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${tab.id}-tab`}
            role="tab"
            aria-selected={tab.id === activeTab}
            aria-controls={panelId}
            tabIndex={tab.id === activeTab ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(tabBase, tab.id === activeTab ? activeStyle : inactiveStyle)}
          >
            {tab.label}
            {tab.id === activeTab && (
              <motion.span
                aria-hidden="true"
                layoutId={`tab-underline-${underlineId}`}
                className="absolute -bottom-[2px] left-0 right-0 h-0.5 bg-brand"
                transition={SPRING.layout}
              />
            )}
          </button>
        ))}

        {/* More dropdown trigger */}
        {hasOverflow && (
          <div ref={moreRef} className="relative">
            <button
              onClick={() => setMoreOpen((prev) => !prev)}
              aria-expanded={moreOpen}
              aria-haspopup="listbox"
              className={cn(
                tabBase,
                "flex items-center gap-1",
                overflowActive ? activeStyle : inactiveStyle,
              )}
            >
              More
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className={cn("motion-safe:transition-transform", moreOpen && "rotate-180")}
              >
                <path
                  d="M3 4.5L6 7.5L9 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {overflowActive && (
                <motion.span
                  aria-hidden="true"
                  layoutId={`tab-underline-${underlineId}`}
                  className="absolute -bottom-[2px] left-0 right-0 h-0.5 bg-brand"
                  transition={SPRING.layout}
                />
              )}
            </button>

            {/* Dropdown menu */}
            <AnimatePresence>
              {moreOpen && (
                <motion.div
                  role="listbox"
                  aria-label="More tabs"
                  variants={slideDownVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  transition={SPRING.pop}
                  style={{ transformOrigin: "top right" }}
                  className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-2xl border border-elevated bg-surface py-1 shadow-card"
                >
                  {overflowTabs.map((tab, i) => (
                    <button
                      key={tab.id}
                      id={`${tab.id}-tab`}
                      role="option"
                      aria-selected={tab.id === activeTab}
                      tabIndex={0}
                      onClick={() => {
                        onChange(tab.id);
                        setMoreOpen(false);
                      }}
                      onKeyDown={(e) => handleKeyDown(e, visibleCount + i)}
                      className={cn(
                        "block w-full whitespace-nowrap px-4 py-2 text-left font-display text-ui font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50",
                        tab.id === activeTab
                          ? "text-brand"
                          : "text-muted hover:bg-elevated hover:text-secondary",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
