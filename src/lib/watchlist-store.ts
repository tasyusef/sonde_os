/**
 * Watchlist kept in the browser (`localStorage`), shared by every
 * `useIntelligence()` caller in the tab and synced across tabs through
 * the `storage` event. Storage can throw (private mode, blocked site
 * data): reads fall back to an empty list and writes still update the
 * in-memory list for the session.
 */

import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

export interface WatchlistItem {
  watchedAddress: string;
  label: string | null;
}

export const WATCHLIST_STORAGE_KEY = "sonde-watchlist";

const EMPTY: WatchlistItem[] = [];

/** Parses the stored JSON. Drops malformed entries and duplicates. */
export function parseWatchlist(raw: string | null): WatchlistItem[] {
  if (!raw) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(parsed)) return EMPTY;
  const seen = new Set<string>();
  const items: WatchlistItem[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { watchedAddress, label } = entry as Record<string, unknown>;
    if (typeof watchedAddress !== "string" || !XRPL_ADDRESS_RE.test(watchedAddress)) continue;
    if (seen.has(watchedAddress)) continue;
    seen.add(watchedAddress);
    items.push({ watchedAddress, label: typeof label === "string" && label ? label : null });
  }
  return items;
}

/** Appends an address (no-op if already present). Blank labels become null. */
export function addItem(items: WatchlistItem[], address: string, label?: string): WatchlistItem[] {
  if (items.some((i) => i.watchedAddress === address)) return items;
  return [...items, { watchedAddress: address, label: label?.trim() || null }];
}

export function removeItem(items: WatchlistItem[], address: string): WatchlistItem[] {
  return items.some((i) => i.watchedAddress === address)
    ? items.filter((i) => i.watchedAddress !== address)
    : items;
}

/* ── Store ─────────────────────────────────────────────────────── */

let current: WatchlistItem[] | null = null;
const listeners = new Set<() => void>();

function load(): WatchlistItem[] {
  try {
    return parseWatchlist(window.localStorage.getItem(WATCHLIST_STORAGE_KEY));
  } catch {
    return EMPTY;
  }
}

function emit() {
  for (const cb of listeners) cb();
}

function onStorage(e: StorageEvent) {
  // `key === null` means another tab cleared storage.
  if (e.key !== null && e.key !== WATCHLIST_STORAGE_KEY) return;
  current = load();
  emit();
}

function commit(next: WatchlistItem[]) {
  if (next === current) return;
  current = next;
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: keep the in-memory list for this session */
  }
  emit();
}

export const watchlistStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    if (listeners.size === 1) window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      if (listeners.size === 0) window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): WatchlistItem[] {
    if (current === null) current = load();
    return current;
  },
  getServerSnapshot(): WatchlistItem[] {
    return EMPTY;
  },
  add(address: string, label?: string) {
    commit(addItem(watchlistStore.getSnapshot(), address, label));
  },
  remove(address: string) {
    commit(removeItem(watchlistStore.getSnapshot(), address));
  },
};
