/**
 * The tokens the search box knows by ticker: the most-held IOUs and MPTs,
 * from XRPL Meta, built by `pnpm tokens` into `src/data/tokens.json`.
 * The file is fetched once, the first time something asks for it (a
 * search), and kept for the session.
 */

import { useEffect, useSyncExternalStore } from "react";
import listUrl from "@/data/tokens.json?url";
import { getKnownName } from "./known-addresses";
import { isMptId, parseTokenId, type TokenRef } from "./token-id";
import { decodeCurrency } from "./xrpl-helpers";

/** One token as the file holds it. Short keys: the file ships to every
 *  browser that searches. */
export interface TokenListEntry {
  /** An IOU's code as its ID has it (`currencyCode`), or an MPT's ticker. */
  c: string;
  /** An MPT's issuance ID; absent for an IOU. */
  m?: string;
  /** Issuer. */
  i: string;
  /** Holders, per XRPL Meta when the list was made. */
  h: number;
  /** XRPL Meta's trust level, 1–3; absent for 0. */
  t?: number;
  /** Token name, issuer name, issuer's domain. */
  n?: string;
  in?: string;
  d?: string;
}

export interface TokenListFile {
  /** The day `pnpm tokens` ran, YYYY-MM-DD. */
  made: string;
  tokens: TokenListEntry[];
}

export interface ListedToken {
  ref: TokenRef;
  /** The ticker as printed. */
  ticker: string;
  name?: string;
  issuer: string;
  issuerName?: string;
  domain?: string;
  holders: number;
  trust: number;
}

export interface TokenList {
  made: string;
  tokens: ListedToken[];
}

/** Reads the file, dropping any entry that doesn't name a token. */
export function parseTokenList(raw: unknown): TokenList {
  const file = raw as Partial<TokenListFile> | null;
  const tokens: ListedToken[] = [];
  for (const e of Array.isArray(file?.tokens) ? file.tokens : []) {
    if (!e || typeof e.c !== "string" || typeof e.i !== "string" || typeof e.h !== "number") continue;
    const ref = e.m ? (isMptId(e.m) ? ({ kind: "mpt", id: e.m.toUpperCase() } as const) : null) : parseTokenId(`${e.c}.${e.i}`);
    if (!ref) continue;
    tokens.push({
      ref,
      ticker: ref.kind === "iou" ? decodeCurrency(ref.currency) : e.c,
      name: e.n,
      issuer: e.i,
      issuerName: e.in ?? getKnownName(e.i) ?? undefined,
      domain: e.d,
      holders: e.h,
      trust: e.t ?? 0,
    });
  }
  return { made: typeof file?.made === "string" ? file.made : "", tokens };
}

/** The list's date, as "30 Oct 2026". */
export const formatListDate = (made: string) =>
  new Date(`${made}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const sameRef = (a: TokenRef, b: TokenRef) =>
  a.kind === "mpt" ? b.kind === "mpt" && a.id === b.id : b.kind === "iou" && a.currency === b.currency && a.issuer === b.issuer;

/** How well `t` matches `q` (lower-cased): 0 is its exact ticker, then
 *  ticker prefix, name, issuer name or domain prefix, anywhere. Null for
 *  no match. */
function score(t: ListedToken, q: string): number | null {
  const ticker = t.ticker.toLowerCase();
  if (ticker === q) return 0;
  const name = t.name?.toLowerCase();
  if (ticker.startsWith(q) || name === q) return 1;
  if (name?.startsWith(q)) return 2;
  const issuer = [t.issuerName?.toLowerCase(), t.domain];
  if (issuer.some((s) => s?.startsWith(q))) return 3;
  if (q.length >= 2 && [ticker, name, ...issuer].some((s) => s?.includes(q))) return 4;
  return null;
}

/**
 * The listed tokens a search names, best first: by ticker, name or
 * issuer for text; every token it issued for an address; the token
 * itself for a token ID. Ties go to XRPL Meta's trust level, then
 * holders, so a known token outranks copies of its ticker.
 */
export function matchTokens(tokens: readonly ListedToken[], query: string, limit = Infinity): ListedToken[] {
  const q = query.trim();
  if (!q) return [];
  const ref = parseTokenId(q);
  if (ref) return tokens.filter((t) => sameRef(t.ref, ref)).slice(0, limit);
  if (tokens.some((t) => t.issuer === q)) return tokens.filter((t) => t.issuer === q).slice(0, limit);
  // A pasted 40-hex code searches as the ticker it spells.
  const lower = (/^[0-9A-Fa-f]{40}$/.test(q) ? decodeCurrency(q.toUpperCase()) : q).toLowerCase();
  return tokens
    .flatMap((t) => {
      const s = score(t, lower);
      return s === null ? [] : [{ t, s }];
    })
    .sort((a, b) => a.s - b.s || b.t.trust - a.t.trust || b.t.holders - a.t.holders)
    .slice(0, limit)
    .map(({ t }) => t);
}

/** A token's entry in the list, with the day the list was made. */
export type Listing = ListedToken & { made: string };

export function findListing(list: TokenList, ref: TokenRef): Listing | null {
  const token = list.tokens.find((t) => sameRef(t.ref, ref));
  return token ? { ...token, made: list.made } : null;
}

/** The one token a search means: its only exact-ticker match, or the
 *  token an ID names. Null when that's not one token. */
export function onlyMatch(tokens: readonly ListedToken[], query: string): ListedToken | null {
  const q = query.trim();
  const exact = parseTokenId(q)
    ? matchTokens(tokens, q)
    : tokens.filter((t) => t.ticker.toLowerCase() === q.toLowerCase());
  return exact.length === 1 ? exact[0] : null;
}

/* ── Store ─────────────────────────────────────────────────────── */

interface ListState {
  list: TokenList | null;
  failed: boolean;
}

const EMPTY: ListState = { list: null, failed: false };
let state = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: ListState) {
  state = next;
  for (const cb of listeners) cb();
}

function load() {
  loading ??= fetch(listUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`token list: HTTP ${res.status}`);
      return res.json();
    })
    .then((raw: unknown) => set({ list: parseTokenList(raw), failed: false }))
    .catch(() => {
      // Let the next ask try again.
      loading = null;
      set({ list: null, failed: true });
    });
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** The token list, fetched on first use (`enabled`). `failed` until a
 *  `retry` gets it. */
export function useTokenList(enabled = true) {
  const current = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => {
    if (enabled) load();
  }, [enabled]);
  return { ...current, retry: load };
}
