import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import PixelIcon from "@/components/shared/PixelIcon";

/** Margin from viewport edges the popover should respect. */
const VIEWPORT_MARGIN = 8;

interface InfoTipProps {
  /** Tooltip content. Plain string or rich JSX (links, formatting). */
  children: ReactNode;
  /** Optional aria-label override for the trigger button.
   *  Defaults to "More information". */
  label?: string;
  /** Side to anchor the popover. `"top"` is the default and is what
   *  most stat-row callers want. Falls back to `"bottom"` when the
   *  popover would clip the top of the viewport. */
  side?: "top" | "bottom";
  /** Optional className for the trigger button (e.g. for sizing
   *  alongside text). */
  className?: string;
}

/**
 * Inline info-icon tooltip. Pattern:
 *
 *   <p>Gini Index <InfoTip>Measures concentration: 0 = perfectly even,
 *      1 = one wallet holds everything.</InfoTip></p>
 *
 * Behavior:
 *   - Desktop hover: opens after 200ms (gentle delay so passing-by
 *     mouse movement doesn't trigger every tooltip in a dense stat row)
 *   - Desktop click + mobile tap: toggles open/closed, click-outside
 *     dismisses. Clicks on the popover content itself don't close it
 *     so users can copy/select text.
 *   - Keyboard: trigger is a real <button>, focus + Enter/Space toggles,
 *     Escape closes.
 *   - Anchoring: defaults to `top`. If the trigger is in the top ~80px
 *     of the viewport (rare for stats, common for headers) the popover
 *     flips to `bottom` so it doesn't clip.
 */
export default function InfoTip({
  children,
  label = "More information",
  side = "top",
  className,
}: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [resolvedSide, setResolvedSide] = useState(side);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLSpanElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHoverTimer() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  // Click outside to close — only relevant when open. Listening on
  // mousedown (not click) so the dismiss happens before any other
  // click handler can fire.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Auto-flip the vertical side on open if the chosen side would
  // clip the top/bottom of the viewport.
  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (side === "top" && rect.top < 80) {
      setResolvedSide("bottom");
    } else if (side === "bottom" && rect.bottom > window.innerHeight - 80) {
      setResolvedSide("top");
    } else {
      setResolvedSide(side);
    }
  }, [open, side]);

  // Horizontal viewport-edge handling. Direct DOM mutation via the
  // popoverRef rather than state — measurement-based positioning
  // doesn't need to participate in React's render cycle, and using
  // setState in an effect is exactly the pattern the
  // `react-hooks/set-state-in-effect` rule (correctly) flags.
  //
  // useLayoutEffect runs synchronously after DOM mutation but BEFORE
  // paint, so the user only ever sees the corrected position. The JSX
  // ships an initial centered transform + 280px maxWidth that this
  // effect overrides if needed.
  useLayoutEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    if (!popover) return;

    const vw = window.innerWidth;
    // Cap width to viewport minus margins so very narrow phones don't
    // force horizontal overflow that no shift can fix.
    const cap = Math.min(280, vw - VIEWPORT_MARGIN * 2);
    popover.style.maxWidth = `${cap}px`;

    // Now measure with the (possibly clamped) width applied and
    // compute the shift needed to keep the popover inside the
    // viewport with VIEWPORT_MARGIN of breathing room on each side.
    const rect = popover.getBoundingClientRect();
    let shift = 0;
    if (rect.left < VIEWPORT_MARGIN) {
      shift = VIEWPORT_MARGIN - rect.left;
    } else if (rect.right > vw - VIEWPORT_MARGIN) {
      shift = vw - VIEWPORT_MARGIN - rect.right;
    }
    popover.style.transform = `translateX(calc(-50% + ${shift}px))`;
  }, [open, resolvedSide]);

  function handleEnter() {
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => setOpen(true), 200);
  }
  function handleLeave() {
    // Delay close so the cursor has time to traverse the small gap
    // between the trigger and the popover (8px of margin between
    // them). Without this grace, hover-leave fires the moment the
    // mouse leaves the icon — popover disappears before the user
    // can reach it.
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => setOpen(false), 120);
  }

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          // Toggle on tap/click — also stops any parent link from
          // firing if the InfoTip lives inside one.
          e.preventDefault();
          e.stopPropagation();
          clearHoverTimer();
          setOpen((v) => !v);
        }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        // The padding, cancelled by the margin, widens the 9px mark's
        // target without moving the line.
        className={cn(
          "-m-1 inline-flex touch-manipulation items-center justify-center p-1 text-muted hover:text-primary",
          className,
        )}
      >
        <PixelIcon name="info" size="sm" />
      </button>
      {open && (
        <span
          ref={popoverRef}
          role="tooltip"
          className={cn(
            "absolute left-1/2 z-50 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-lg",
            resolvedSide === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
          // Initial values — useLayoutEffect mutates these directly via
          // the ref to clamp width and apply any viewport-edge shift,
          // synchronously before paint so the user never sees the
          // pre-adjustment state.
          style={{
            width: "max-content",
            maxWidth: 280,
            transform: "translateX(-50%)",
          }}
          // Block hover-leave dismiss when the cursor moves onto the
          // popover so users can read longer copy.
          onMouseEnter={clearHoverTimer}
          onMouseLeave={handleLeave}
        >
          {/* Reset typography inherited from stat labels (which are
              uppercase + tracking-header + font-mono). Tooltip prose
              wants body font, normal case, normal letter spacing,
              and comfortable leading. */}
          <span className="block font-body text-cell font-normal normal-case tracking-normal text-primary leading-read-sm">
            {children}
          </span>
        </span>
      )}
    </span>
  );
}
