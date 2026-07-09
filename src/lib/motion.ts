/**
 * Motion language for Sonde.
 *
 * One small vocabulary of spring presets + a few shared gesture
 * constants — every animated component on the site routes through
 * these instead of inlining its own stiffness/damping/duration so
 * the feel stays coherent. If a transition isn't listed here it
 * probably shouldn't be inventing its own — extend this module
 * instead.
 *
 * Authoring rules:
 *  - Use `transform`/`opacity` whenever possible (GPU compositing).
 *  - For compound morphs where multiple things are changing at once
 *    (size + position + content swap), reach for `SPRING.layout`,
 *    pair with `AnimatePresence mode="popLayout"` for content swap,
 *    and consider the motion-blur smoothing trick (see
 *    `UnifiedSearch.tsx` for the canonical example).
 *  - Springs feel better than tweens for most things. Reach for a
 *    duration-based ease only when the motion has no natural rest
 *    state (e.g. a long-running progress indicator) — never for an
 *    enter/exit or a state swap.
 *
 * Presets:
 *  - `snap`    — hover/tap/press feedback. Very damped, sub-200ms.
 *  - `smooth`  — default for most state transitions, color shifts,
 *                small reveals. Mild bounce.
 *  - `layout`  — layout shifts, morphs, growing/shrinking elements.
 *                Tighter rest thresholds so the tail has more
 *                interpolation samples (smoother settle).
 *  - `pop`     — overlays, dropdowns, icons appearing. Definite
 *                bounce — reads as "something arrived".
 *
 * Damping ratio cheat sheet (for tuning):
 *  - ratio = damping / (2 * sqrt(stiffness * mass))
 *  - 1.0    → critically damped, no overshoot, sluggish
 *  - 0.85   → very subtle one-beat overshoot
 *  - 0.7    → noticeable bounce
 *  - 0.5    → obvious springiness
 *  - <0.4   → cartoonish, avoid
 */

import type { Transition, Variants } from "motion/react";

export const SPRING = {
  snap: {
    type: "spring",
    stiffness: 600,
    damping: 30,
    mass: 0.7,
  },
  smooth: {
    type: "spring",
    stiffness: 460,
    damping: 35,
    mass: 0.9,
  },
  layout: {
    type: "spring",
    stiffness: 460,
    damping: 35,
    mass: 0.9,
    restDelta: 0.0005,
    restSpeed: 0.005,
  },
  pop: {
    type: "spring",
    stiffness: 540,
    damping: 23,
    mass: 0.8,
    restDelta: 0.0005,
    restSpeed: 0.005,
  },
} as const satisfies Record<string, Transition>;

/* ——— Gesture scales ———
 * Use as `whileHover={{ scale: HOVER_SCALE }}` and
 * `whileTap={{ scale: TAP_SCALE }}` on `motion.button` / `motion.a`.
 * Icon-only controls have less visual mass, so the feedback needs
 * to be a touch larger for the same perceived push.
 *
 * Squash & stretch is achieved implicitly: pair `whileTap` with
 * `transition: SPRING.pop` so the release from the tap scale
 * (e.g. 0.94) overshoots past 1.0 briefly before settling. The
 * spring's natural ringing IS the stretch — no keyframes needed.
 *   ✗ snap → flat thunk, no life
 *   ✓ pop  → squash down + spring back with subtle overshoot
 */
export const HOVER_SCALE = 1.03;
export const TAP_SCALE = 0.94;
export const ICON_HOVER_SCALE = 1.08;
export const ICON_TAP_SCALE = 0.88;

/* ——— Shared enter/exit variants ———
 * Pair with `SPRING.pop` for dropdowns/overlays, `SPRING.smooth`
 * for subtler reveals. */

/** Scale + fade. The "this just appeared" variant. */
export const popVariants: Variants = {
  hidden: { opacity: 0, scale: 0.7 },
  visible: { opacity: 1, scale: 1 },
};

/** Slide-down + fade. Use for panels anchored to a trigger (sub-
 *  menus, type-picker dropdowns) so they feel like they're
 *  unfolding from the trigger. */
export const slideDownVariants: Variants = {
  hidden: { opacity: 0, y: -6, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1 },
};

/** Plain fade. Use sparingly — most things should also move. */
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};
