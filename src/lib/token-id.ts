/**
 * A token's ID in Sonde's URLs and search box. An issued currency (IOU)
 * is `CODE.rIssuer`: its code as printed when that maps back to the
 * ledger's form (`SOLO`, `USD`), else the 40-hex. A multi-purpose token
 * (MPT) is its 48-hex issuance ID.
 */

import { decodeAccountID, isValidClassicAddress } from "ripple-address-codec";
import { decodeCurrency, toLedgerCurrency } from "./xrpl-helpers";

export type TokenRef =
  | { kind: "iou"; currency: string; issuer: string }
  | { kind: "mpt"; id: string };

/** The characters a 3-char ledger code may use (XRPL docs). */
const STANDARD_CODE = /^[A-Za-z0-9?!@#$%^&*<>(){}[\]|]{3}$/;
const HEX_CODE = /^[0-9A-F]{40}$/;

export const isMptId = (s: string) => /^[0-9A-Fa-f]{48}$/.test(s);

/** A currency as the ledger holds it: a 3-char code other than XRP, or
 *  40 hex. */
export const isLedgerCurrency = (c: string) =>
  (STANDARD_CODE.test(c) && c.toUpperCase() !== "XRP") || HEX_CODE.test(c);

/** An AMM's LP token: hex starting 03, never a real ticker. */
export const isLpCurrency = (c: string) => c.length === 40 && c.startsWith("03");

/** The code an ID uses for `currency`: as printed when that maps back
 *  to it, else its hex. */
export function currencyCode(currency: string): string {
  const shown = decodeCurrency(currency);
  return toLedgerCurrency(shown) === currency ? shown : currency;
}

export function tokenId(ref: TokenRef): string {
  return ref.kind === "mpt" ? ref.id : `${currencyCode(ref.currency)}.${ref.issuer}`;
}

/** Reads an ID. The code is everything before the last dot, so a code
 *  with a dot in it still reads. Null when it names no token. */
export function parseTokenId(id: string): TokenRef | null {
  if (isMptId(id)) return { kind: "mpt", id: id.toUpperCase() };
  const dot = id.lastIndexOf(".");
  if (dot <= 0) return null;
  const issuer = id.slice(dot + 1);
  const currency = toLedgerCurrency(id.slice(0, dot));
  if (!isValidClassicAddress(issuer) || !isLedgerCurrency(currency)) return null;
  return { kind: "iou", currency, issuer };
}

/** An MPT's issuance ID: the issuer's sequence when it made the token,
 *  then the issuer's account ID, as 48 hex. */
export function mptIssuanceId(sequence: number, issuer: string): string {
  const account = Array.from(decodeAccountID(issuer), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${sequence.toString(16).padStart(8, "0")}${account}`.toUpperCase();
}

/** The page a token opens. */
export const tokenPath = (ref: TokenRef) => `/token/${encodeURIComponent(tokenId(ref))}`;
