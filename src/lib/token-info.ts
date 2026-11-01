/**
 * Reading a token's ledger objects for its page: an IOU's issuer
 * (AccountRoot) and XRP pool (`amm_info`), an MPT's issuance and its
 * XLS-89 metadata.
 */

import type { AMMInfoResult } from "@/types/amm";
import { hexToUtf8 } from "./hex";

/** An issuer's `lsfGlobalFreeze`: none of its tokens can move. */
export const GLOBAL_FREEZE = 0x00400000;

/** Settings on an IOU issuer's account that say how its tokens behave. */
const ISSUER_FLAGS: ReadonlyArray<[number, string]> = [
  [GLOBAL_FREEZE, "Frozen"],
  [0x00040000, "Requires auth"],
  [0x00200000, "No freeze"],
  [0x80000000, "Clawback"],
];

/** An MPT issuance's `lsfMPTLocked`: no holder can move it. */
export const MPT_LOCKED = 0x01;

const MPT_FLAGS: ReadonlyArray<[number, string]> = [
  [MPT_LOCKED, "Locked"],
  [0x02, "Can lock"],
  [0x04, "Requires auth"],
  [0x08, "Escrow"],
  [0x10, "Tradable"],
  [0x20, "Transferable"],
  [0x40, "Clawback"],
];

const labels = (flags: number, table: ReadonlyArray<[number, string]>) =>
  table.filter(([mask]) => (flags & mask) !== 0).map(([, label]) => label);

export const issuerFlags = (flags: number) => labels(flags, ISSUER_FLAGS);
export const mptFlags = (flags: number) => labels(flags, MPT_FLAGS);

/** An issuer's `TransferRate` as a fee: 1,000,000,000 (or none) is 0%. */
export function transferRatePercent(rate: number | undefined): number {
  return rate && rate > 1e9 ? (rate - 1e9) / 1e7 : 0;
}

/** An MPT's `TransferFee`: 0–50,000, in thousandths of a percent. */
export const mptFeePercent = (fee: number | undefined) => (fee ?? 0) / 1000;

/** A percentage, as short as it stays exact ("0.2%", "1.25%"). */
export const formatPercent = (pct: number) => `${Number(pct.toFixed(4))}%`;

/** The XRP and the token in a pool against XRP, and what one token
 *  costs in XRP. Null when the pool is empty or not against XRP. */
export function poolPrice(amm: AMMInfoResult["amm"]): { xrp: number; tokens: number; price: number } | null {
  const sides = [amm.amount, amm.amount2];
  const drops = sides.find((a) => typeof a === "string");
  const token = sides.find((a) => typeof a !== "string");
  if (typeof drops !== "string" || !token || typeof token === "string") return null;
  const xrp = Number(drops) / 1e6;
  const tokens = Number(token.value);
  if (!(xrp > 0 && tokens > 0)) return null;
  return { xrp, tokens, price: xrp / tokens };
}

const TOKEN_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const SMALL_FORMAT = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });

/** A token amount: two decimals from 1 up, four significant digits
 *  below ("0.0001234"). */
export function formatTokenAmount(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n) >= 1 || n === 0 ? TOKEN_FORMAT.format(n) : SMALL_FORMAT.format(n);
}

export interface MptLink {
  uri: string;
  category?: string;
  title?: string;
}

/** XLS-89 metadata. Every field is the issuer's word, unchecked. */
export interface MptMetadata {
  ticker?: string;
  name?: string;
  desc?: string;
  icon?: string;
  assetClass?: string;
  assetSubclass?: string;
  issuerName?: string;
  links: MptLink[];
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Reads `MPTokenMetadata`: hex of a JSON object, in XLS-89's long keys
 * (`ticker`) or its compact ones (`t`). Null when it isn't JSON.
 */
export function parseMptMetadata(hex: string | undefined): MptMetadata | null {
  if (!hex) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(hexToUtf8(hex));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const field = (long: string, compact: string) => text(o[long] ?? o[compact]);
  const uris = o.uris ?? o.us;
  return {
    ticker: field("ticker", "t"),
    name: field("name", "n"),
    desc: field("desc", "d"),
    icon: field("icon", "i"),
    assetClass: field("asset_class", "ac"),
    assetSubclass: field("asset_subclass", "as"),
    issuerName: field("issuer_name", "in"),
    links: (Array.isArray(uris) ? uris : []).flatMap((u): MptLink[] => {
      if (!u || typeof u !== "object") return [];
      const r = u as Record<string, unknown>;
      const uri = text(r.uri ?? r.u);
      return uri ? [{ uri, category: text(r.category ?? r.c), title: text(r.title ?? r.t) }] : [];
    }),
  };
}

/** A web link the page can open: http(s) only, never `javascript:`. */
export function webUrl(uri: string): string | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(uri) ? uri : `https://${uri}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
