"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import ResponsiveSelect from "@/components/shared/ResponsiveSelect";
import {
  HOVER_SCALE,
  ICON_HOVER_SCALE,
  ICON_TAP_SCALE,
  SPRING,
  TAP_SCALE,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

/* Icon-only variants used by the topbar submit button. The button
 * itself can't scale (its parent form has overflow-hidden + rounded
 * corners, so any growth past the form edge gets clipped and reads
 * as a layout glitch), so we cascade the scale to the icon child
 * via Framer's variant propagation: the parent motion.button drives
 * the gesture state, this object controls what the icon does. */
const submitIconVariants: Variants = {
  rest: { scale: 1 },
  hover: { scale: ICON_HOVER_SCALE, transition: SPRING.snap },
  tap: { scale: ICON_TAP_SCALE, transition: SPRING.pop },
};
import {
  SEARCH_TYPES,
  SEARCH_TYPE_ORDER,
  type SearchType,
} from "./types";

// Morph slot entrance/exit — slightly more extreme than the default
// `popVariants` (scale 0.5 vs 0.7) because the icon is small and we
// want a pronounced pop when it appears in place of the pill.
const MORPH_HIDDEN = { opacity: 0, scale: 0.5 };
const MORPH_VISIBLE = { opacity: 1, scale: 1 };

interface UnifiedSearchProps {
  /**
   * `topbar` is the persistent desktop bar — single row with pill,
   * input, and a submit button on the right. `overlay` is the mobile
   * FAB-triggered card — single row with a "morph" left element: it
   * shows the type-picker pill while the input is empty or invalid,
   * then swaps in-place to a submit button the moment the input
   * matches the picked type's format.
   */
  variant?: "topbar" | "overlay";
  /** Auto-focus the input on mount — used by the mobile overlay. */
  autoFocus?: boolean;
  /** Called after a successful submit so the host (overlay) can close. */
  onSubmit?: () => void;
}

/**
 * Global unified search form.
 *
 * Type is explicit — picked from the dropdown — so we don't infer
 * what the user is searching from input shape (a known source of
 * bugs in the old universal-infer hook). Each type owns its own
 * validator + route via `SEARCH_TYPES[type].route(input)`; submit
 * is gated until the route helper returns a path.
 *
 * Dropdown uses the shared `ResponsiveSelect` so it matches every
 * other dropdown across headers (`CollectionItems` sort,
 * `ProfileTab` section picker, etc.) instead of rolling its own
 * pill chrome.
 */
export default function UnifiedSearch({
  variant = "topbar",
  autoFocus,
  onSubmit,
}: UnifiedSearchProps) {
  const router = useRouter();
  const [type, setType] = useState<SearchType>("account");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isMorphing, setIsMorphing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Defer auto-focus to a microtask so it lands AFTER any parent's
  // focus-trap initial-focus pass (which would otherwise grab the
  // overlay's Close button as the first focusable in DOM order).
  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [autoFocus]);

  const options = useMemo(
    () =>
      SEARCH_TYPE_ORDER.map((t) => ({
        value: t,
        label: SEARCH_TYPES[t].label,
      })),
    [],
  );

  const config = SEARCH_TYPES[type];
  const route = input.trim() ? config.route(input) : null;
  const canSubmit = !!route;

  // Drive the faux motion blur from real canSubmit transitions.
  // Compares against the previous value in a ref rather than using an
  // `isMounted` flag, because React 19 + Strict Mode double-invokes
  // effects on mount, which made the flag flip from false → true on
  // the throwaway run and then fire the morph on the real run. A ref
  // initialised to the current `canSubmit` value sidesteps that —
  // both Strict Mode runs see `prev === current`, no morph fires
  // until the user actually causes a transition.
  const prevCanSubmitRef = useRef(canSubmit);
  useEffect(() => {
    if (prevCanSubmitRef.current === canSubmit) return;
    prevCanSubmitRef.current = canSubmit;
    setIsMorphing(true);
    // Slightly longer than the LAYOUT_SPRING settle (~300ms) so the
    // blur covers the full motion plus the small tail.
    const t = window.setTimeout(() => setIsMorphing(false), 360);
    return () => window.clearTimeout(t);
  }, [canSubmit]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!route) {
      setError(`Doesn't match the expected ${config.label.toLowerCase()} format.`);
      return;
    }
    onSubmit?.();
    router.push(route);
  };

  const isOverlay = variant === "overlay";

  const dropdown = (
    <ResponsiveSelect
      options={options}
      active={type}
      onChange={(v) => {
        setType(v);
        setError(null);
      }}
      ariaLabel="Search type"
      desktopVariant="select"
      triggerClassName={isOverlay ? "h-13 sm:h-13" : "h-10 sm:h-10"}
    />
  );

  const inputEl = (
    <input
      ref={inputRef}
      type="text"
      value={input}
      onChange={(e) => {
        setInput(e.target.value);
        setError(null);
      }}
      placeholder={config.placeholder}
      aria-label={`Search ${config.label}`}
      aria-invalid={!!error}
      aria-describedby={error ? "unified-search-error" : undefined}
      className={cn(
        "min-w-0 flex-1 bg-transparent font-body text-primary placeholder:text-muted outline-none",
        // 16px on mobile keeps iOS from auto-zooming on focus.
        isOverlay
          ? "px-4 py-3.5 text-ui max-sm:text-[16px]"
          : "px-3 py-2 text-ui max-sm:text-[16px]",
      )}
    />
  );

  return (
    <div className="w-full">
      {isOverlay ? (
        // Overlay variant — single row, "morph" right element:
        //   • input empty/invalid → type-picker pill (so user can
        //     pick or switch type before typing).
        //   • input matches format → circular submit button (replaces
        //     the pill in-place; pressing Enter inside the input also
        //     submits, but the visible button gives the moment its
        //     own affordance and frees ~50px for the input). This
        //     also signals "your input is valid, go" without a
        //     separate enabled/disabled state.
        // The swap is two coordinated motions:
        //   1. The morph slot (right flex child) shrinks/grows
        //      between pill width (~101px) and circle width (52px).
        //      Framer's `layout` prop animates the size transition
        //      via `LAYOUT_SPRING`.
        //   2. The input wrapper (left flex child) also gets
        //      `layout` so it fluidly grows into the freed space —
        //      both motions share the same spring so they stay
        //      synced.
        //   3. Inside the morph slot, `AnimatePresence mode="popLayout"`
        //      handles the content swap: the outgoing element fades +
        //      scales out (absolutely positioned via popLayout so it
        //      doesn't fight the container's layout transition), and
        //      the incoming element pops in with a slight overshoot.
        // `initial={false}` skips animating the very first mount, so
        // opening the dialog doesn't trigger a spurious pop.
        <form
          onSubmit={handleSubmit}
          role="search"
          // Faux motion blur — applied to the entire form so both the
          // shrinking pill/circle and the growing input get a hint
          // of blur during the layout transition. 0.5px is well below
          // legibility threshold but enough to mask any sub-pixel
          // jitter the eye picks up as "not quite smooth". The CSS
          // transition on `filter` fades it in/out softly so the blur
          // itself doesn't read as a state change.
          style={{
            filter: isMorphing ? "blur(0.5px)" : "blur(0px)",
            transition: "filter 140ms ease-out",
            willChange: "filter",
          }}
          className="flex w-full items-stretch gap-2"
        >
          <motion.div
            layout
            transition={SPRING.layout}
            style={{ willChange: "transform" }}
            className={cn(
              "flex min-w-0 flex-1 items-stretch overflow-hidden rounded-2xl border bg-surface transition-colors focus-within:border-brand/30",
              error ? "border-error/50" : "border-elevated",
            )}
          >
            {inputEl}
          </motion.div>

          <motion.div
            layout
            transition={SPRING.layout}
            style={{ willChange: "transform" }}
            className="flex shrink-0 items-stretch"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {canSubmit ? (
                <motion.div
                  key="submit"
                  initial={MORPH_HIDDEN}
                  animate={MORPH_VISIBLE}
                  exit={MORPH_HIDDEN}
                  transition={SPRING.pop}
                  className="flex items-stretch"
                >
                  {/* Standalone circular button — no clipping parent,
                       so the whole button gets the motion-language
                       scale gesture (snap on hover, pop on tap so the
                       release overshoots past 1.0). */}
                  <motion.button
                    type="submit"
                    aria-label="Submit search"
                    whileHover={{ scale: HOVER_SCALE, transition: SPRING.snap }}
                    whileTap={{ scale: TAP_SCALE, transition: SPRING.pop }}
                    className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                  >
                    <Search size={20} aria-hidden="true" />
                  </motion.button>
                </motion.div>
              ) : (
                <motion.div
                  key="dropdown"
                  initial={MORPH_HIDDEN}
                  animate={MORPH_VISIBLE}
                  exit={MORPH_HIDDEN}
                  transition={SPRING.pop}
                  className="flex items-stretch"
                >
                  {dropdown}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </form>
      ) : (
        // Topbar variant — desktop, three persistent elements with
        // the dropdown on the right end: input form (with submit
        // baked into its right edge) then the type pill outside.
        // No morph because the row has plenty of horizontal room
        // and the always-on dropdown reads as a filter chip.
        <div className="flex w-full items-center gap-2">
          <form
            onSubmit={handleSubmit}
            role="search"
            className={cn(
              "flex min-w-0 flex-1 items-stretch overflow-hidden rounded-2xl border bg-surface transition-colors focus-within:border-brand/30",
              error ? "border-error/50" : "border-elevated",
            )}
          >
            {inputEl}
            {/* Topbar submit button — embedded inside the search
                 form's overflow-hidden + rounded-2xl wrapper, so we
                 can't scale the button itself without clipping. Drives
                 the gesture state on the button via `initial`/
                 `whileHover`/`whileTap` variant names, then propagates
                 to the icon child which actually scales. Skips the
                 hover/tap variants entirely when `canSubmit` is false
                 — no motion feedback on a disabled control. */}
            <motion.button
              type="submit"
              disabled={!canSubmit}
              aria-label="Submit search"
              initial="rest"
              animate="rest"
              whileHover={canSubmit ? "hover" : undefined}
              whileTap={canSubmit ? "tap" : undefined}
              className="flex shrink-0 items-center justify-center bg-brand px-4 text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-elevated disabled:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <motion.span
                variants={submitIconVariants}
                className="inline-flex"
              >
                <Search size={16} aria-hidden="true" />
              </motion.span>
            </motion.button>
          </form>

          {dropdown}
        </div>
      )}

      {error && (
        <p
          id="unified-search-error"
          role="alert"
          className="mt-1.5 px-1 font-mono text-label text-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
