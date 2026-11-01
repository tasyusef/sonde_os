import { useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { rovingIndex } from "@/lib/roving-index";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { fitTabs } from "./fitTabs";
import MoreMenu, { MoreLabel } from "./MoreMenu";
import { useTabMetrics } from "./useTabMetrics";

const tabBase =
  "relative whitespace-nowrap pb-3 font-display text-caps uppercase";
const moreBase = cn(tabBase, "flex items-center gap-1");

const activeStyle = "text-primary";
const inactiveStyle = "text-muted hover:text-primary";

/**
 * Underline tab strip (APG tabs, automatic activation). Tabs that don't
 * fit go under a "More" listbox beside the tablist.
 *
 * - One Tab stop, on the active tab. ArrowLeft/Right wrap through every
 *   tab, overflow ones included; Home/End jump to the ends. Focus follows
 *   the selection.
 * - The active tab is always in the strip with `id="${id}-tab"`, so a
 *   panel's `aria-labelledby` always resolves. Selecting an overflow tab
 *   (by arrow or from More) promotes it into the strip.
 */
export default function Tabs({
  tabs,
  activeTab,
  onChange,
  panelId,
  ariaLabel,
}: {
  tabs: { id: string; label: string }[];
  activeTab: string;
  onChange: (id: string) => void;
  /** ID of the associated tabpanel element for aria-controls linkage */
  panelId?: string;
  /** Accessible name for the tablist, e.g. "Account sections". */
  ariaLabel?: string;
}) {
  const underlineId = useId();
  const { containerRef, measureRef, metrics } = useTabMetrics(
    tabs.map((t) => `${t.id}\u0000${t.label}`).join("\u0001"),
  );
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  // Set when a selection lands on a tab that isn't mounted yet (it's
  // being promoted out of More); focused once the strip re-renders.
  const pendingFocus = useRef<string | null>(null);

  const activeIndex = tabs.findIndex((t) => t.id === activeTab);
  const measured = metrics !== null && metrics.widths.length === tabs.length;
  const visible = new Set(measured ? fitTabs(metrics, activeIndex) : tabs.keys());
  const overflowTabs = tabs.filter((_, i) => !visible.has(i));
  // A stale `activeTab` still leaves one way into the tablist.
  const tabStop = activeIndex === -1 ? Math.min(...visible) : activeIndex;

  // Layout effect so focus moves before paint, not via a frame on <body>.
  useLayoutEffect(() => {
    if (pendingFocus.current !== activeTab) return;
    pendingFocus.current = null;
    tabRefs.current.get(activeTab)?.focus();
  }, [activeTab]);

  const select = (id: string) => {
    const el = tabRefs.current.get(id);
    pendingFocus.current = el ? null : id;
    el?.focus();
    onChange(id);
  };

  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    const next = rovingIndex(e.key, index, tabs.length, {
      orientation: "horizontal",
      wrap: true,
    });
    if (next === null) return;
    e.preventDefault();
    select(tabs[next].id);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Hidden measurement row — every tab plus the More trigger, offscreen */}
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
        <span className={moreBase}>
          <MoreLabel />
        </span>
      </div>

      <div className="flex gap-6 border-b border-line">
        <div role="tablist" aria-label={ariaLabel} className="flex gap-6">
          {tabs.map((tab, index) => {
            if (!visible.has(index)) return null;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(tab.id, el);
                  else tabRefs.current.delete(tab.id);
                }}
                type="button"
                id={`${tab.id}-tab`}
                role="tab"
                aria-selected={isActive}
                aria-controls={panelId}
                tabIndex={index === tabStop ? 0 : -1}
                onClick={() => onChange(tab.id)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                className={cn(tabBase, isActive ? activeStyle : inactiveStyle)}
              >
                {tab.label}
                {isActive && (
                  <motion.span
                    aria-hidden="true"
                    layoutId={`tab-underline-${underlineId}`}
                    className="absolute -bottom-[2px] left-0 right-0 h-0.5 bg-brand"
                    transition={SPRING.layout}
                  />
                )}
              </button>
            );
          })}
        </div>

        {overflowTabs.length > 0 && (
          <MoreMenu
            tabs={overflowTabs}
            onSelect={select}
            triggerClassName={cn(moreBase, inactiveStyle)}
          />
        )}
      </div>
    </div>
  );
}
