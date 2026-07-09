"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Drop-in replacement for `useState<string>(defaultTab)` that persists the
 * active tab in a URL query param so refreshing or sharing the link
 * restores the user's tab selection.
 *
 * Usage:
 * ```tsx
 * // before:
 * const [tab, setTab] = useState<TabId>("transactions");
 *
 * // after:
 * const [tab, setTab] = useTabSlug<TabId>("transactions");
 * ```
 *
 * For pages with multiple Tabs instances (e.g., the Account page has
 * Holdings → sub-toggle, Positions → sub-toggle), pass distinct
 * `paramName` values so each tab tier has its own URL key:
 * ```tsx
 * const [tab, setTab] = useTabSlug("transactions", "tab");
 * const [holdingsView, setHoldingsView] = useTabSlug("tokens", "holdings");
 * // → ?tab=holdings&holdings=trustlines
 * ```
 *
 * Behavior:
 * - Initial value comes from the URL search param at first paint (so
 *   `?tab=holdings` boots the page on the holdings tab).
 * - Subsequent updates write to `window.history.replaceState` directly
 *   instead of `router.replace`. The previous router.replace path
 *   triggered a full server soft-navigation on every click — fine when
 *   the SSR is sub-200ms, miserable when CH is loaded (e.g. during a
 *   backfill) and the page takes 1-3s to respond. Click-to-feedback was
 *   gated by the slowest server response, and rapid spam-clicks queued
 *   pending navigations that masked themselves as "nothing happened".
 *   The new path is pure client state plus a URL-sync side effect, so
 *   tab clicks are instant regardless of server load.
 * - Back/forward still work via the popstate listener.
 * - When the active value equals the default, the param is REMOVED from
 *   the URL — keeps default URLs clean (`/network` not `/network?tab=overview`).
 * - Type parameter `T extends string` so consumers can keep their narrow
 *   tab-id union types and get full type safety on setActive.
 */
// Overload 1: no explicit generic — use plain `string`. This is the
// common case (consumers passing a literal default like "transactions"
// without wanting their tab IDs as a narrow union). Returns
// [string, (next: string) => void] so equality checks against any
// string literal work without TS narrowing complaints.
export function useTabSlug(
  defaultTab: string,
  paramName?: string,
): [string, (next: string) => void];

// Overload 2: explicit narrow generic — preserves the union type so
// consumers using a discriminated TabId get full type safety on
// setActive. Pass like `useTabSlug<TabId>("overview")`.
export function useTabSlug<T extends string>(
  defaultTab: T,
  paramName?: string,
): [T, (next: T) => void];

export function useTabSlug<T extends string>(
  defaultTab: T,
  paramName: string = "tab",
): [T, (next: T) => void] {
  const searchParams = useSearchParams();

  // Initial value from the URL — this is what the SSR rendered with so
  // the first client render matches the server (no hydration mismatch).
  // After mount we maintain local state and sync URL via replaceState.
  const [activeTab, setActive] = useState<T>(
    () => (searchParams.get(paramName) ?? defaultTab) as T,
  );

  // Keep state in sync with browser back/forward navigation. Reading
  // searchParams in a popstate handler gives us the URL the user just
  // navigated to.
  useEffect(() => {
    const onPopState = () => {
      const url = new URL(window.location.href);
      const next = (url.searchParams.get(paramName) ?? defaultTab) as T;
      setActive(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [paramName, defaultTab]);

  const setActiveTab = useCallback(
    (next: T) => {
      setActive(next);
      const url = new URL(window.location.href);
      if (next === defaultTab) {
        url.searchParams.delete(paramName);
      } else {
        url.searchParams.set(paramName, next);
      }
      // replaceState rather than pushState — tab changes shouldn't fill
      // history with one entry per click. Same trade-off as the
      // pre-existing router.replace call.
      window.history.replaceState(null, "", url.toString());
    },
    [paramName, defaultTab],
  );

  return [activeTab, setActiveTab];
}
