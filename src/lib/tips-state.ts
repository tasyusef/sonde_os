"use client";

import { useSyncExternalStore } from "react";

/**
 * Per-page tutorial-tooltip state.
 *
 * Two pieces:
 *   1. A localStorage flag per pageId tracking "user has completed
 *      or dismissed the tour for this page." Used by `<TipTour>` to
 *      decide whether to auto-start.
 *   2. A small event bus so `<TipsButton>` can re-trigger the tour
 *      on its page from anywhere on the screen (e.g. a header
 *      button rendered above the tour itself in the React tree).
 *
 * Both pieces are intentionally lightweight — no Context provider
 * wrap, no Zustand. Just a localStorage namespace + an EventTarget.
 */

const STORAGE_PREFIX = "sonde:tips-completed:";

/* ── localStorage ────────────────────────────────────────────── */

const completedListeners = new Map<string, Set<() => void>>();

function notifyCompleted(pageId: string) {
  completedListeners.get(pageId)?.forEach((cb) => cb());
}

function readCompleted(pageId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + pageId) === "true";
  } catch {
    return false;
  }
}

function writeCompleted(pageId: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + pageId, String(value));
  } catch {
    /* storage blocked — silently ignore */
  }
  notifyCompleted(pageId);
}

/**
 * Hook: read the "tips already completed/dismissed" flag for a page.
 * Built on `useSyncExternalStore` (same pattern as `useCollapsibleCard`)
 * so the value is available synchronously during render — no flash of
 * "auto-start tour" on mount for users who've already dismissed it.
 */
export function useTipsCompleted(pageId: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      let set = completedListeners.get(pageId);
      if (!set) {
        set = new Set();
        completedListeners.set(pageId, set);
      }
      set.add(cb);

      // Cross-tab sync via window storage event.
      const storageHandler = (e: StorageEvent) => {
        if (e.key === STORAGE_PREFIX + pageId) cb();
      };
      window.addEventListener("storage", storageHandler);

      return () => {
        const current = completedListeners.get(pageId);
        if (current) {
          current.delete(cb);
          if (current.size === 0) completedListeners.delete(pageId);
        }
        window.removeEventListener("storage", storageHandler);
      };
    },
    () => readCompleted(pageId),
    () => false,
  );
}

export function setTipsCompleted(pageId: string, value: boolean) {
  writeCompleted(pageId, value);
}

/* ── Restart bus ─────────────────────────────────────────────── */

/**
 * `<TipsButton>` dispatches a "restart" message for its pageId; the
 * matching `<TipTour>` (which may be rendered elsewhere on the page)
 * listens and resets its internal step state. Decouples the two
 * components without forcing a Context provider on every page.
 */
const restartListeners = new Map<string, Set<() => void>>();

export function dispatchRestartTips(pageId: string) {
  restartListeners.get(pageId)?.forEach((cb) => cb());
}

export function subscribeRestartTips(pageId: string, cb: () => void) {
  let set = restartListeners.get(pageId);
  if (!set) {
    set = new Set();
    restartListeners.set(pageId, set);
  }
  set.add(cb);
  return () => {
    const current = restartListeners.get(pageId);
    if (current) {
      current.delete(cb);
      if (current.size === 0) restartListeners.delete(pageId);
    }
  };
}
