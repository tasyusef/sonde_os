"use client";

import { type ReactNode, useId } from "react";
import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCollapsibleCard } from "@/hooks/useCollapsibleCard";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Standard collapsible-accordion card. Header height matches the
 * existing card header convention (`px-4 py-card-header` directly
 * on a single full-row button) so the row sits at the same height
 * as the offer / history / portfolio card headers throughout the
 * app — no nested button-with-negative-margin trick that quietly
 * broke vertical rhythm by ~8px.
 *
 * `storageKey` namespaces expand-state in localStorage via
 * `useCollapsibleCard` — pass distinct keys per card so users'
 * preferences survive reloads independently.
 *
 * Optional `count` renders a muted number after the title (matches
 * the "Transaction History 12" pattern). Optional `actions` slot
 * renders right-aligned outside the button so clicks don't toggle.
 *
 * `lockOpen` renders the card as a static panel — same chrome and
 * title header, but no toggle button, no chevron, body always
 * expanded. Use this when the same component needs to be a real
 * accordion in one layout (mobile stack) and a fixed-open info
 * card in another (desktop two-column).
 */
export default function CollapsibleCard({
  title,
  count,
  storageKey,
  defaultExpanded = true,
  actions,
  children,
  className,
  lockOpen = false,
}: {
  title: string;
  count?: number;
  storageKey: string;
  defaultExpanded?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  lockOpen?: boolean;
}) {
  const [expanded, toggle] = useCollapsibleCard(storageKey, defaultExpanded);
  const bodyId = useId();
  const prefersReducedMotion = useReducedMotion();

  const headerInner = (
    <>
      <span className="font-display text-label font-bold uppercase tracking-header text-brand">
        {title}
      </span>
      {typeof count === "number" && (
        <span className="font-mono text-label text-muted">{count}</span>
      )}
      {!lockOpen && (
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-muted transition-transform duration-200 motion-reduce:duration-0",
            expanded && "rotate-180",
          )}
        />
      )}
    </>
  );

  const headerBase = "flex items-center gap-2 px-4 py-card-header";
  const header = lockOpen ? (
    <div className={cn(headerBase, actions ? "flex-1" : "w-full")}>
      {headerInner}
    </div>
  ) : (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={expanded}
      aria-controls={bodyId}
      className={cn(
        headerBase,
        actions ? "flex-1" : "w-full",
        "text-left transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
      )}
    >
      {headerInner}
    </button>
  );

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl bg-surface shadow-card",
        className,
      )}
    >
      {actions ? (
        <div className="flex items-stretch">
          {header}
          <div className="flex items-center pr-4">{actions}</div>
        </div>
      ) : (
        header
      )}
      {/* Body. When `lockOpen`, render as a plain static panel — no
           animation, no aria-hidden. Otherwise wrap in `motion.div`
           with `height: auto`/`0` driven by `SPRING.layout` for a
           consistent spring-y open/close.
           Hydration safety: `useCollapsibleCard` reads localStorage
           synchronously via `useSyncExternalStore`, so the value is
           correct from the first render. Paired with `initial={false}`
           on the motion.div, this means the very first paint matches
           the stored state without triggering a phantom collapse
           animation (the bug that pushed us to CSS max-height
           previously). Respects `prefers-reduced-motion` by zeroing
           the spring duration. */}
      {lockOpen ? (
        <div>
          <div className="border-t border-elevated">{children}</div>
        </div>
      ) : (
        <motion.div
          id={bodyId}
          initial={false}
          animate={{
            height: expanded ? "auto" : 0,
            opacity: expanded ? 1 : 0,
          }}
          transition={prefersReducedMotion ? { duration: 0 } : SPRING.layout}
          aria-hidden={!expanded}
          style={{ overflow: "hidden" }}
        >
          <div className="border-t border-elevated">{children}</div>
        </motion.div>
      )}
    </section>
  );
}
