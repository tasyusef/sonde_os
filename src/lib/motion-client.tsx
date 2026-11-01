/**
 * Client-only motion primitives. Kept apart from `motion.ts` so that
 * module stays plain constants any file can import.
 *
 * See "Reduced motion" in `motion.ts` for when to use which.
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router";
import { MotionConfig, motion } from "motion/react";

/** Root reduced-motion gate. Mounted once in `root.tsx`. With
 *  `reducedMotion="user"`, transform and layout animations (x, y,
 *  scale, rotate, width, height…) jump straight to their target when
 *  the OS asks for reduced motion. Opacity, filter, colour and
 *  `pathLength` still animate, so looping effects need their own
 *  gate. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** React Router `<Link>` that takes motion props (entrances, hover
 *  variants). Put them here instead of on a `motion.div` wrapper: a
 *  `whileTap` there makes a non-focusable element `tabindex="0"`, which
 *  leaves a nameless, dead Tab stop. */
export const MotionLink = motion.create(Link);

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Hydration-safe reduced-motion flag. `false` on the server and during
 * hydration, then the live preference (React re-renders right after
 * hydrating if it differs). Client-side navigations get the real value
 * on the first render.
 *
 * Use this, not motion's `useReducedMotion()`, whenever the flag changes
 * markup or SSR-visible props (`initial`, `style`, rendering `null`).
 * `useReducedMotion()` is `false` on the server but `true` on the first
 * client render, so the trees differ, React throws #418 and re-renders
 * the root, which drops the `html.light` class the theme script set.
 */
export function useHydratedReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
