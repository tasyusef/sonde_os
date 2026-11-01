import { useCallback, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";

const noopSubscribe = () => () => {};

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
 * - The URL is the state: the tab is read from the search param, so
 *   back/forward and links that set `?tab=` just work.
 * - Updates replace the history entry (tab clicks shouldn't fill history)
 *   and keep the scroll position.
 * - When the active value equals the default, the param is REMOVED from
 *   the URL — keeps default URLs clean (`/network` not `/network?tab=overview`).
 * - While hydrating it returns the default: prerendered pages (`/network`)
 *   were built without a query string, so reading `?tab=` then would
 *   mismatch the HTML. React re-renders with the URL's tab right after.
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
  const [searchParams, setSearchParams] = useSearchParams();
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const activeTab = hydrated ? ((searchParams.get(paramName) ?? defaultTab) as T) : defaultTab;

  const setActiveTab = useCallback(
    (next: T) => {
      setSearchParams(
        // `prev` is a fresh copy, safe to mutate.
        (prev) => {
          if (next === defaultTab) prev.delete(paramName);
          else prev.set(paramName, next);
          return prev;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams, paramName, defaultTab],
  );

  return [activeTab, setActiveTab];
}
