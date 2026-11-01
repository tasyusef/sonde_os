/**
 * The last few searches, newest first (a 64-hex ID once the ledger has
 * placed it), kept in the browser (`localStorage`) for the sidebar's
 * Recent list and synced across tabs through the `storage` event.
 * Storage can throw (private mode, blocked site data): reads fall back
 * to an empty list and writes still update the in-memory list for the
 * session.
 */

import type { SearchHit, SearchKind } from "./search";

export const RECENT_STORAGE_KEY = "sonde-recent-searches";
export const RECENT_MAX = 5;

const KINDS: readonly SearchKind[] = ["account", "transaction", "ledger", "nft", "token"];
const EMPTY: SearchHit[] = [];

const sameHit = (a: SearchHit, b: SearchHit) => a.kind === b.kind && a.id === b.id;

/** Parses the stored JSON. Drops malformed entries and duplicates, and
 *  keeps at most `RECENT_MAX`. */
export function parseRecent(raw: string | null): SearchHit[] {
  if (!raw) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(parsed)) return EMPTY;
  const hits: SearchHit[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { kind, id } = entry as Record<string, unknown>;
    if (!KINDS.includes(kind as SearchKind) || typeof id !== "string" || !id) continue;
    const hit = { kind: kind as SearchKind, id };
    if (hits.some((h) => sameHit(h, hit))) continue;
    hits.push(hit);
    if (hits.length === RECENT_MAX) break;
  }
  return hits;
}

/** Puts `hit` first, moving it up if it's already there. */
export function addRecent(hits: SearchHit[], hit: SearchHit): SearchHit[] {
  if (hits.length > 0 && sameHit(hits[0], hit)) return hits;
  return [hit, ...hits.filter((h) => !sameHit(h, hit))].slice(0, RECENT_MAX);
}

/* ── Store ─────────────────────────────────────────────────────── */

let current: SearchHit[] | null = null;
const listeners = new Set<() => void>();

function load(): SearchHit[] {
  try {
    return parseRecent(window.localStorage.getItem(RECENT_STORAGE_KEY));
  } catch {
    return EMPTY;
  }
}

function emit() {
  for (const cb of listeners) cb();
}

function onStorage(e: StorageEvent) {
  // `key === null` means another tab cleared storage.
  if (e.key !== null && e.key !== RECENT_STORAGE_KEY) return;
  current = load();
  emit();
}

function commit(next: SearchHit[]) {
  if (next === current) return;
  current = next;
  try {
    if (next.length) window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(RECENT_STORAGE_KEY);
  } catch {
    /* storage blocked: keep the in-memory list for this session */
  }
  emit();
}

export const recentSearches = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    if (listeners.size === 1) window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      if (listeners.size === 0) window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): SearchHit[] {
    if (current === null) current = load();
    return current;
  },
  getServerSnapshot(): SearchHit[] {
    return EMPTY;
  },
  add(hit: SearchHit) {
    commit(addRecent(recentSearches.getSnapshot(), hit));
  },
  clear() {
    commit(EMPTY);
  },
};
