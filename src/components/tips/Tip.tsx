"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { popVariants, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { TipStep } from "./types";

/* "Are we past hydration on the client?" gate. SSR returns false,
 * client first render returns false (matches SSR — no hydration
 * mismatch), then re-renders with true after React has hydrated.
 * Used to delay mounting the portal until createPortal's
 * `document.body` is actually available. */
const subscribeNoop = () => () => {};
function useIsHydrated() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

const TIP_GAP = 12; // px between target edge and tip card
// Min margin from viewport edges. 28px (was 12) so interactive buttons
// inside the tip — Skip on the bottom-left, the X on the top-right —
// stay clear of mobile browser edge-swipe gesture zones. iOS reserves
// ~20px for back/forward; Arc adds its own gesture layer on top. Taps
// that landed inside those zones were getting captured as swipes
// before the React onClick ever fired, which read as "Skip is broken."
const VIEWPORT_PADDING = 28;
const TIP_MAX_WIDTH = 340;
const ARROW_SIZE = 6; // half-size of the CSS triangle

type Placement = NonNullable<TipStep["placement"]>;

interface TipProps {
  step: TipStep;
  currentIndex: number;
  total: number;
  onPrev?: () => void;
  onNext: () => void;
  onSkip: () => void;
}

interface Position {
  /** Top/left in viewport-fixed coordinates. */
  top: number;
  left: number;
  /** Which side of the target the tip ended up on (post auto-flip). */
  placement: Placement;
  /** Offset along the side-perpendicular axis where the arrow should
   *  point — px from the tip's edge. Lets the arrow track the target's
   *  center even when the tip itself is clamped to the viewport. */
  arrowOffset: number;
}

/**
 * Single tooltip rendered into a portal at the document body. Anchors
 * to a DOM element by CSS selector, auto-flips if the preferred side
 * would push it off-screen, and clamps to the viewport with the arrow
 * still pointing at the target.
 *
 * Animates in via the shared `popVariants` + `SPRING.pop` — same vocab
 * as overlay dropdowns elsewhere on the site so the tip reads as
 * "something just arrived" without feeling out-of-system.
 */
export default function Tip({
  step,
  currentIndex,
  total,
  onPrev,
  onNext,
  onSkip,
}: TipProps) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const isHydrated = useIsHydrated();

  // Position the tip whenever the target or window geometry changes.
  // useLayoutEffect (not useEffect) so the first paint already has
  // the correct coordinates — avoids a frame of "tip at 0,0".
  useLayoutEffect(() => {
    function compute() {
      const target = document.querySelector(step.target) as HTMLElement | null;
      const tipEl = tipRef.current;
      if (!target || !tipEl) {
        setPosition(null);
        return;
      }

      const targetRect = target.getBoundingClientRect();
      // Use offsetWidth/Height for the tip's own size — these are the
      // LAYOUT dimensions and ignore CSS transforms. getBoundingClientRect
      // would return scale(0.7)-shrunk values during the entry animation
      // (the tip's popVariants hidden state has scale: 0.7), which made
      // the right-edge clamp under-shoot and let the tip overflow the
      // viewport on the right.
      const tipRect = {
        width: tipEl.offsetWidth,
        height: tipEl.offsetHeight,
      };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const preferred = step.placement ?? "bottom";

      // Available room on each side of the target.
      const room = {
        top: targetRect.top,
        bottom: vh - targetRect.bottom,
        left: targetRect.left,
        right: vw - targetRect.right,
      };

      const needed = {
        vertical: tipRect.height + TIP_GAP + VIEWPORT_PADDING,
        horizontal: tipRect.width + TIP_GAP + VIEWPORT_PADDING,
      };

      // Auto-flip: if preferred side doesn't fit, try its opposite.
      function chooseSide(): Placement {
        if (preferred === "bottom" && room.bottom < needed.vertical && room.top >= needed.vertical) {
          return "top";
        }
        if (preferred === "top" && room.top < needed.vertical && room.bottom >= needed.vertical) {
          return "bottom";
        }
        if (preferred === "right" && room.right < needed.horizontal && room.left >= needed.horizontal) {
          return "left";
        }
        if (preferred === "left" && room.left < needed.horizontal && room.right >= needed.horizontal) {
          return "right";
        }
        return preferred;
      }

      const placement = chooseSide();

      let top: number;
      let left: number;
      let arrowOffset: number;

      if (placement === "bottom" || placement === "top") {
        // Top/bottom: tip sits above/below target, centered horizontally.
        const targetCenterX = targetRect.left + targetRect.width / 2;
        const idealLeft = targetCenterX - tipRect.width / 2;
        left = Math.max(
          VIEWPORT_PADDING,
          Math.min(vw - tipRect.width - VIEWPORT_PADDING, idealLeft),
        );
        top =
          placement === "bottom"
            ? targetRect.bottom + TIP_GAP
            : targetRect.top - tipRect.height - TIP_GAP;
        // Arrow tracks the target center even after clamping.
        arrowOffset = Math.max(
          ARROW_SIZE * 2,
          Math.min(tipRect.width - ARROW_SIZE * 2, targetCenterX - left),
        );
      } else {
        // Left/right: tip sits beside target, vertically centered.
        const targetCenterY = targetRect.top + targetRect.height / 2;
        const idealTop = targetCenterY - tipRect.height / 2;
        top = Math.max(
          VIEWPORT_PADDING,
          Math.min(vh - tipRect.height - VIEWPORT_PADDING, idealTop),
        );
        left =
          placement === "right"
            ? targetRect.right + TIP_GAP
            : targetRect.left - tipRect.width - TIP_GAP;
        arrowOffset = Math.max(
          ARROW_SIZE * 2,
          Math.min(tipRect.height - ARROW_SIZE * 2, targetCenterY - top),
        );
      }

      setPosition({ top, left, placement, arrowOffset });
    }

    compute();

    // Recompute on every event that could move the target or change
    // the viewport. ResizeObserver covers cards growing/shrinking;
    // scroll + resize cover viewport changes.
    window.addEventListener("scroll", compute, { passive: true, capture: true });
    window.addEventListener("resize", compute);
    const target = document.querySelector(step.target);
    const observer = target ? new ResizeObserver(compute) : null;
    if (target && observer) observer.observe(target);

    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      observer?.disconnect();
    };
  }, [step.target, step.placement]);

  if (!isHydrated) return null;
  const isLast = currentIndex === total - 1;

  // Arrow positioning per side. The arrow is a CSS triangle on a
  // pseudo absolute-positioned element of the card.
  const arrowStyle = position
    ? (() => {
        switch (position.placement) {
          case "bottom":
            return {
              top: -ARROW_SIZE,
              left: position.arrowOffset - ARROW_SIZE,
              transform: "rotate(45deg)",
            };
          case "top":
            return {
              bottom: -ARROW_SIZE,
              left: position.arrowOffset - ARROW_SIZE,
              transform: "rotate(225deg)",
            };
          case "right":
            return {
              left: -ARROW_SIZE,
              top: position.arrowOffset - ARROW_SIZE,
              transform: "rotate(-45deg)",
            };
          case "left":
            return {
              right: -ARROW_SIZE,
              top: position.arrowOffset - ARROW_SIZE,
              transform: "rotate(135deg)",
            };
        }
      })()
    : null;

  return createPortal(
    <motion.div
      ref={tipRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`tip-title-${step.id}`}
      variants={popVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      transition={SPRING.pop}
      style={{
        position: "fixed",
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        maxWidth: TIP_MAX_WIDTH,
        // Hide the tip until we've measured. opacity (not display) so
        // the ref still measures correctly on the first useLayoutEffect
        // pass.
        opacity: position ? 1 : 0,
        zIndex: 60,
      }}
      className="pointer-events-auto w-[88vw] touch-manipulation sm:w-auto"
    >
      <div className="relative rounded-2xl border border-brand/30 bg-surface shadow-card">
        {/* Arrow — small rotated square peeking out from the appropriate
             edge. Shares the card's border so the seam reads as a
             single pointed shape. */}
        {arrowStyle && (
          <span
            aria-hidden="true"
            className="absolute h-3 w-3 border-l border-t border-brand/30 bg-surface"
            style={arrowStyle}
          />
        )}

        <div className="relative flex flex-col gap-3 px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <h3
              id={`tip-title-${step.id}`}
              className="flex-1 font-display text-ui font-bold tracking-tight text-primary"
            >
              {step.title}
            </h3>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-tag tabular-nums text-muted">
                {currentIndex + 1} / {total}
              </span>
              {/* Close (X) — primary dismiss path. Distinct geometry from
                   the bottom-left "Skip tour" so even if some viewport-
                   edge weirdness eats taps in one corner, the other still
                   works. ~40px hit area, no negative-margin trickery.
                   `touch-manipulation` again to keep iOS from delaying
                   the click while it watches for a double-tap. */}
              <button
                type="button"
                onClick={onSkip}
                aria-label="Dismiss tour"
                className="inline-flex h-9 w-9 touch-manipulation items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="font-body text-cell leading-relaxed text-secondary">
            {step.body}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            {/* Skip — backup dismiss path (primary is the X in the
                 header). Padding sets a real ~38px hit target, no
                 negative-margin trick so the tap zone stays strictly
                 inside the card. `touch-manipulation` suppresses iOS's
                 300ms double-tap-wait that otherwise cancels the click
                 on the slightest finger movement. */}
            <button
              type="button"
              onClick={onSkip}
              className="touch-manipulation rounded-lg px-3 py-2 font-mono text-label text-muted transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {onPrev && (
                <button
                  type="button"
                  onClick={onPrev}
                  className={cn(
                    "touch-manipulation rounded-lg border border-elevated px-3 py-1.5 font-mono text-label text-primary",
                    "transition-colors hover:border-brand/30 hover:text-brand",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                  )}
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={onNext}
                className={cn(
                  "touch-manipulation rounded-lg bg-brand px-3 py-1.5 font-mono text-label font-medium text-white",
                  "transition-colors hover:bg-brand/90",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                )}
              >
                {isLast ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
