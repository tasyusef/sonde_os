"use client";

import { useSyncExternalStore } from "react";

/**
 * Reports whether the current device supports a fine pointer that
 * can hover (desktop mouse, trackpad). Returns `false` on touch-only
 * devices (mobile, tablet without an attached pointer device).
 *
 * Powered by the `(hover: hover)` media query, which is the standard
 * way to detect hover support — more accurate than UA sniffing and
 * automatically handles hybrid devices (e.g. a touchscreen laptop
 * is still hover-capable through its trackpad).
 *
 * Built on `useSyncExternalStore` (same pattern as `useCollapsibleCard`)
 * so the value is read SYNCHRONOUSLY during render — no useEffect
 * post-mount setState that would let the `whileInView` trigger fire
 * once with the wrong assumption before flipping to the correct
 * value. SSR snapshot is `true` (assume hover-capable) since
 * matchMedia isn't available there; client first render uses the
 * real media query result.
 *
 * Live-updates on hover-support changes (user connects/disconnects a
 * Bluetooth mouse on a tablet, for example), so the UI re-adapts
 * without a reload.
 */
function subscribe(onChange: () => void) {
  const mq = window.matchMedia("(hover: hover)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia("(hover: hover)").matches;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useHoverSupported(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
