/**
 * Motion language for Sonde.
 *
 * One small vocabulary of spring presets: every animated component
 * routes through these instead of inlining its own stiffness, damping
 * or duration, so the feel stays coherent. If a transition isn't
 * listed here, extend this module.
 *
 * Authoring rules:
 *  - Animate `transform`/`opacity`/`height`. Never scale or blur text:
 *    an in-between size of a bitmap face is a smudge.
 *  - Hover and press feedback is the colour inversion, which is
 *    instant (CSS transitions default to 0s in `globals.css`). Only
 *    the primary action also moves: one `nudge` to the right.
 *  - Gestures and variants go on the real `<a>`/`<button>`
 *    (`motion.button`, `MotionLink` from `motion-client.tsx`), never a
 *    wrapper `motion.div`: `whileTap` makes the wrapper a dead Tab stop.
 *
 * Reduced motion:
 *  - `MotionProvider` (`motion-client.tsx`) wraps the app in
 *    `<MotionConfig reducedMotion="user">`, so transforms and layout
 *    animations jump to their target for users who ask for less
 *    motion. Nothing to do per component for x/y/rotate.
 *  - Opacity, height and CSS animations are NOT covered. Pass
 *    `INSTANT` for height yourself; use `motion-reduce:` in CSS.
 *  - Never let the flag change SSR output. Motion's
 *    `useReducedMotion()` differs between server and first client
 *    render, so use `useHydratedReducedMotion()` for anything that
 *    changes markup, `initial` or `style`.
 *
 * Damping ratio, for tuning: damping / (2 * sqrt(stiffness * mass)).
 * 1 is critically damped (no overshoot), 0.85 a subtle one-beat
 * overshoot, 0.7 a noticeable bounce, under 0.5 cartoonish.
 */

import type { Transition, Variants } from "motion/react";

/* ——— Presets ———
 *  - `snap`   icon exits and other swaps that should be quick and flat.
 *  - `smooth` the default for state changes and small reveals.
 *  - `layout` collapses, a tab's underline, a field giving up width.
 *             Tighter rest thresholds give the settle more samples.
 *  - `pop`    overlays, dropdowns, icons arriving: a definite bounce,
 *             so it reads as "something arrived".
 *  - `sheet`  sheets crossing the screen. Critically damped: any
 *             overshoot shows as the sheet lifting off the edge. */
export const SPRING = {
  snap: { type: "spring", stiffness: 600, damping: 30, mass: 0.7 },
  smooth: { type: "spring", stiffness: 460, damping: 35, mass: 0.9 },
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
  sheet: { type: "spring", stiffness: 500, damping: 45, mass: 1 },
} as const satisfies Record<string, Transition>;

/** Jump straight to the target. For reduced-motion branches that
 *  `MotionProvider` doesn't cover (height, opacity). */
export const INSTANT = { duration: 0 } as const satisfies Transition;

/** `Decode`'s scramble: the glyphs swap `fps` times a second and the
 *  text settles over `frames` of them. A cadence, not a curve: each
 *  swap is a whole glyph, so it has no in-between to smooth. */
export const DECODE = { fps: 12, frames: 12 } as const;

/* ——— Shared enter/exit variants ———
 * No scale anywhere: text stays at its crisp size throughout. */

/** Drops in from its trigger. With `SPRING.pop`, for panels anchored
 *  to a trigger (menus, type pickers). */
export const slideDownVariants: Variants = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0 },
};

/** Height collapse and fade for disclosure bodies, with
 *  `SPRING.layout` (`<Collapse>`). It clips only while it moves:
 *  closing clips at once, opening unclips once it lands, so a focus
 *  ring inside isn't cut off while it's open. */
export const collapseVariants: Variants = {
  hidden: { height: 0, opacity: 0, overflow: "hidden" },
  visible: { height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } },
};

/** Appear/disappear: overlays, icon swaps (`SPRING.pop`) and arriving
 *  rows (`SPRING.smooth`). */
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};
