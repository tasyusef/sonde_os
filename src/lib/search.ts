/**
 * What the search box takes, and where it goes. One box, no type to
 * pick: the input's shape says what it is. An r-address is an account,
 * digits are a ledger index, and a 48-hex MPT ID or `CODE.rIssuer` is a
 * token. A 64-hex ID could be a transaction, a ledger or an NFT, so
 * `/search/<id>` asks the ledger which (`search-resolve`). Any other
 * text is a ticker or a name, which `/search/<text>` looks up in the
 * token list (`token-list`).
 */

import { isValidClassicAddress } from "ripple-address-codec";
import { parseTokenId, tokenId } from "./token-id";

export type SearchKind = "account" | "transaction" | "ledger" | "nft" | "token";

/** A search that knows what it found. */
export interface SearchHit {
  kind: SearchKind;
  id: string;
}

/** Shaped like a classic address. Its checksum may still be wrong. */
export const looksLikeAddress = (s: string) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s);
/** A classic address whose checksum holds, so a typo never opens a page. */
const isAddress = (s: string) => looksLikeAddress(s) && isValidClassicAddress(s);
const is64Hex = (s: string) => /^[A-Fa-f0-9]{64}$/.test(s);
const isUint = (s: string) => /^\d+$/.test(s);
/** Digits grouped the way the site prints a ledger index in the reader's
 *  locale ("107,964,761", "107.964.761", "107 964 761"), so a number
 *  copied off a page searches too. One separator, groups of three. */
const GROUPED_UINT = /^\d{1,3}([,. \u00A0\u202F'\u2019])\d{3}(?:\1\d{3})*$/;
const ledgerIndex = (s: string) =>
  isUint(s) ? s : GROUPED_UINT.test(s) ? s.replace(/\D/g, "") : null;
/** A token's ID, also with a space for the dot (`SOLO rsoLo…`), as the
 *  pages print it. */
function token(s: string): string | null {
  const ref = parseTokenId(s.replace(/^(\S+)\s+(r\w+)$/, "$1.$2"));
  return ref && tokenId(ref);
}

/**
 * Reads the search box. `kind` is null for a 64-hex ID, which only the
 * ledger can place; its `id` is upper-cased, as the pages print it.
 * Null when the input is none of these, so it's text to look up. 64-hex
 * is checked before digits, so an all-digit hash isn't read as a ledger
 * index, and 48-hex before digits for the same reason.
 */
export function parseSearch(input: string): { kind: SearchKind | null; id: string } | null {
  const trimmed = input.trim();
  if (isAddress(trimmed)) return { kind: "account", id: trimmed };
  if (is64Hex(trimmed)) return { kind: null, id: trimmed.toUpperCase() };
  const tokenHit = token(trimmed);
  if (tokenHit) return { kind: "token", id: tokenHit };
  const index = ledgerIndex(trimmed);
  return index ? { kind: "ledger", id: index } : null;
}

const PAGES: Record<SearchKind, string> = {
  account: "/account/",
  transaction: "/tx/",
  ledger: "/ledger/",
  nft: "/nft/",
  token: "/token/",
};

/** The page a hit opens. A token's code can hold any character. */
export const hitPath = ({ kind, id }: SearchHit) => PAGES[kind] + encodeURIComponent(id);
