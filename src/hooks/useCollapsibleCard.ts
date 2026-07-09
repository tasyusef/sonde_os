"use client";

import { useCallback, useSyncExternalStore } from "react";

const NS = "sonde:collapse:";

/* In-memory per-key listener registry. The native `storage` event
 * doesn't fire in the same tab that called `setItem`, so cross-card
 * sync within a tab needs its own pub/sub. The `storage` listener
 * inside `subscribe` covers cross-tab sync separately. */
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((cb) => cb());
}

function readValue(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = window.localStorage.getItem(NS + key);
    if (raw === "true" || raw === "false") return raw === "true";
  } catch {
    /* storage blocked — keep default */
  }
  return defaultValue;
}

function writeValue(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NS + key, String(value));
  } catch {
    /* silently ignore */
  }
  notify(key);
}

/**
 * Per-card expand/collapse state with localStorage persistence.
 * Used by sidebar intel widgets so the user's preferred layout
 * survives reloads + per-account navigation.
 *
 * Returns `[expanded, toggle, setExpanded]`. The `key` should be a
 * stable identifier for the widget (e.g. "risk", "behavioral") and
 * is namespaced under `sonde:collapse:` in localStorage.
 *
 * Built on `useSyncExternalStore` so the value is read synchronously
 * during the first render — there's no post-mount `useEffect`-driven
 * setState that would let an `AnimatePresence`/`layout` animation
 * fire on the hydration step. This is what makes it safe for
 * `CollapsibleCard` to use Framer Motion for the body transition.
 *
 * Cross-tab sync via the `storage` window event; same-tab sync via
 * an in-memory listener registry (the native `storage` event doesn't
 * fire in the originating tab).
 */
export function useCollapsibleCard(
  key: string,
  defaultExpanded = true,
): [boolean, () => void, (value: boolean) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(onChange);

      const storageHandler = (e: StorageEvent) => {
        if (e.key === NS + key) onChange();
      };
      window.addEventListener("storage", storageHandler);

      return () => {
        const current = listeners.get(key);
        if (current) {
          current.delete(onChange);
          if (current.size === 0) listeners.delete(key);
        }
        window.removeEventListener("storage", storageHandler);
      };
    },
    [key],
  );

  const getSnapshot = useCallback(
    () => readValue(key, defaultExpanded),
    [key, defaultExpanded],
  );
  const getServerSnapshot = useCallback(
    () => defaultExpanded,
    [defaultExpanded],
  );

  const expanded = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setExpanded = useCallback(
    (value: boolean) => writeValue(key, value),
    [key],
  );

  const toggle = useCallback(
    () => writeValue(key, !readValue(key, defaultExpanded)),
    [key, defaultExpanded],
  );

  return [expanded, toggle, setExpanded];
}
