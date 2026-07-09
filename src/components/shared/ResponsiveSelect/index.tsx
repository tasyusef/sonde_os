"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Toggle from "@/components/shared/Toggle";
import {
  HOVER_SCALE,
  SPRING,
  TAP_SCALE,
  slideDownVariants,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface ResponsiveSelectOption<T extends string> {
  value: T;
  /** Plain string label used inside the dropdown's option list. Also
   *  the trigger's collapsed label when `desktopLabel` isn't provided. */
  label: string;
  /** Optional richer label for the desktop Toggle render (e.g. embed
   *  a parenthesized count that disappears on mobile). Falls back to
   *  `label` when omitted. Only used when `desktopVariant="toggle"`. */
  desktopLabel?: ReactNode;
}

interface ResponsiveSelectProps<T extends string> {
  options: ResponsiveSelectOption<T>[];
  active: T;
  onChange: (value: T) => void;
  /** Override the active-item text color on the desktop Toggle. */
  accentClass?: string;
  /** ARIA label — the radio group on desktop, the listbox on mobile. */
  ariaLabel?: string;
  /** Optional class applied to the dropdown wrapper, for layout
   *  tweaks (e.g. `w-full`). */
  mobileClassName?: string;
  /** Optional class merged onto the dropdown trigger button — use to
   *  override the default 24/36px control height when the parent row
   *  is taller (e.g. sitting next to a 40px search input). */
  triggerClassName?: string;
  /**
   * Desktop rendering mode:
   * - "toggle" (default) — pill radio group at sm+, custom dropdown below sm.
   *   Best for 2-3 short-labeled options where one-click switching beats
   *   a dropdown round-trip.
   * - "select" — custom dropdown at every breakpoint. Use when 4+ options
   *   or descriptive labels would clutter the desktop header.
   */
  desktopVariant?: "toggle" | "select";
}

/**
 * ResponsiveSelect — Toggle on desktop, custom dropdown on mobile (or at
 * every breakpoint when `desktopVariant="select"`).
 *
 * The dropdown is a hand-rolled overlay rather than a native `<select>`
 * for two reasons: (1) iOS forces ≥16px font on real `<select>` elements
 * to suppress focus-zoom, which made our pill triggers visually heavier
 * than the surrounding Toggle/tab labels. The custom overlay sidesteps
 * that and uses the same `font-mono text-label uppercase tracking-pill`
 * style as Toggle, keeping headers visually unified. (2) We get a
 * dropdown panel we can style — animated entry, branded selection
 * state, check-icon — instead of the OS picker.
 */
export default function ResponsiveSelect<T extends string>({
  options,
  active,
  onChange,
  accentClass,
  ariaLabel,
  mobileClassName,
  triggerClassName,
  desktopVariant = "toggle",
}: ResponsiveSelectProps<T>) {
  const renderToggleOnDesktop = desktopVariant === "toggle";

  return (
    <>
      {renderToggleOnDesktop && (
        <div className="hidden sm:block">
          <Toggle
            options={options.map((o) => ({
              value: o.value,
              label: o.desktopLabel ?? o.label,
            }))}
            active={active}
            onChange={onChange}
            accentClass={accentClass}
            ariaLabel={ariaLabel}
          />
        </div>
      )}

      <CustomSelect
        options={options}
        active={active}
        onChange={onChange}
        ariaLabel={ariaLabel}
        className={cn(
          renderToggleOnDesktop && "sm:hidden",
          mobileClassName,
        )}
        triggerClassName={triggerClassName}
      />
    </>
  );
}

/** Pill-shaped trigger + animated dropdown panel. Shape and chrome
 *  match the Toggle component (rounded-full, bg-elevated border).
 *  Text styling matches Toggle / tab labels so headers stay unified
 *  across Toggle, custom dropdown, and tab strip. */
function CustomSelect<T extends string>({
  options,
  active,
  onChange,
  ariaLabel,
  className,
  triggerClassName,
}: {
  options: ResponsiveSelectOption<T>[];
  active: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  // Panel alignment is contextual — it always biases toward the center
  // of the viewport, so a trigger on the left edge extends RIGHTWARD
  // (instead of pushing the panel into the screen edge), and a trigger
  // on the right extends LEFTWARD. Measured synchronously in the click
  // handler before `open` flips, so the panel renders with the correct
  // alignment on the very first frame — no flicker.
  const [alignment, setAlignment] = useState<"left" | "right">("left");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    if (!open && triggerRef.current && typeof window !== "undefined") {
      const rect = triggerRef.current.getBoundingClientRect();
      const triggerCenterX = rect.left + rect.width / 2;
      const viewportCenterX = window.innerWidth / 2;
      setAlignment(triggerCenterX > viewportCenterX ? "right" : "left");
    }
    setOpen((v) => !v);
  }, [open]);

  // Outside click + Escape — same pattern as DropdownMenu/Tabs.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const activeOption = options.find((o) => o.value === active);

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block", className)}
    >
      {/* Pill trigger — standalone (no clipping parent). Uses
           `SPRING.smooth` instead of `SPRING.snap` for the hover
           scale because the pill contains text, and snap's overshoot
           on the 1.03 scale change re-rasterizes the text twice (up,
           past, back) which reads as edge jitter. `willChange:
           transform` locks the pill onto its own GPU layer so the
           text only rasterizes once. Tap still uses `SPRING.pop` —
           the squash-and-stretch overshoot is the whole point. */}
      <motion.button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={toggle}
        whileHover={{ scale: HOVER_SCALE, transition: SPRING.smooth }}
        whileTap={{ scale: TAP_SCALE, transition: SPRING.pop }}
        style={{ willChange: "transform" }}
        className={cn(
          "inline-flex min-h-[var(--ctrl-h-mobile)] items-center gap-1.5 rounded-full border border-elevated bg-elevated px-3 font-mono text-label font-medium uppercase tracking-pill text-primary transition-colors hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:min-h-[var(--ctrl-h-desktop)]",
          triggerClassName,
        )}
      >
        <span>{activeOption?.label ?? ""}</span>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={ariaLabel}
            variants={slideDownVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={SPRING.pop}
            style={{
              transformOrigin: alignment === "right" ? "top right" : "top left",
            }}
            className={cn(
              "absolute top-full z-50 mt-1.5 min-w-[160px] overflow-hidden rounded-2xl border border-elevated bg-surface py-1 shadow-card",
              alignment === "right" ? "right-0" : "left-0",
            )}
          >
            {options.map((o) => {
              const isSelected = o.value === active;
              return (
                // List-row hover gesture — subtler than the pill
                // trigger because rows shouldn't "pop"; they're
                // not standalone affordances. Scale 1.015 anchored
                // to the left edge: enough motion that the eye reads
                // "this row is responding", small enough that the
                // bg-elevated highlight remains the dominant signal.
                //
                // Two things keep this smooth on small text:
                //   - `willChange: transform` locks the row onto its
                //     own GPU layer so the text rasterizes ONCE and
                //     the layer is transformed without re-sampling.
                //     Without this, every frame of the scale animation
                //     re-rasterizes the label at a slightly different
                //     sub-pixel scale, which reads as text-edge
                //     "wiggle."
                //   - `SPRING.smooth` (damping ~0.86) instead of
                //     `SPRING.snap` (~0.73). For a 0.015 scale change,
                //     snap's overshoot is large enough to read as
                //     visible bounce.
                //
                // `originX: 0` (left edge) prevents a sliver of
                // panel-bg peeking on the left during the scale (the
                // panel has overflow-hidden, so growing rightward is
                // fine; growing both directions from center would
                // leave a 1-2px gap on the left).
                <motion.button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(o.value);
                    close();
                  }}
                  whileHover={{ scale: 1.015, transition: SPRING.smooth }}
                  whileTap={{ scale: 0.98, transition: SPRING.pop }}
                  style={{ originX: 0, willChange: "transform" }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-mono text-label font-medium uppercase tracking-pill transition-colors",
                    "focus-visible:outline-none focus-visible:bg-elevated",
                    isSelected
                      ? "bg-brand/10 text-brand"
                      : "text-primary hover:bg-elevated",
                  )}
                >
                  <span>{o.label}</span>
                  {isSelected && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="shrink-0"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
