/**
 * Search-type definitions for the global unified search bar.
 *
 * The user explicitly picks a type from the dropdown, so the route
 * helper only validates the format for that type — no auto-detect /
 * inferred routing. Single-input first pass: every type takes a plain
 * text input. Autocomplete (tokens by name, collections by name, etc.)
 * can layer on per-type later without changing this contract.
 */

export type SearchType =
  | "account"
  | "transaction"
  | "nft"
  | "token"
  | "collection"
  | "ledger";

export interface SearchTypeConfig {
  /** Stable identifier (also matches the dropdown `<option>` value). */
  id: SearchType;
  /** Label shown in the dropdown and aria-labels. */
  label: string;
  /** Input placeholder. Should hint at the expected format. */
  placeholder: string;
  /**
   * Validates + routes. Returns the destination path, or `null` if the
   * trimmed input doesn't match the expected format for this type.
   * Submit is disabled when this returns `null`.
   */
  route: (input: string) => string | null;
}

const isAddress = (s: string) => /^r[a-zA-Z0-9]{24,34}$/.test(s);
const is64Hex = (s: string) => /^[A-Fa-f0-9]{64}$/.test(s);
const isUint = (s: string) => /^\d+$/.test(s);

export const SEARCH_TYPES: Record<SearchType, SearchTypeConfig> = {
  account: {
    id: "account",
    label: "Account",
    placeholder: "Enter r-address",
    route: (input) => {
      const trimmed = input.trim();
      return isAddress(trimmed) ? `/account/${trimmed}` : null;
    },
  },
  transaction: {
    id: "transaction",
    label: "Transaction",
    placeholder: "Enter transaction hash (64-char hex)",
    route: (input) => {
      const trimmed = input.trim();
      return is64Hex(trimmed) ? `/tx/${trimmed}` : null;
    },
  },
  nft: {
    id: "nft",
    label: "NFT",
    placeholder: "Enter NFTokenID (64-char hex)",
    route: (input) => {
      const trimmed = input.trim();
      return is64Hex(trimmed) ? `/nft/${trimmed}` : null;
    },
  },
  token: {
    id: "token",
    label: "Token",
    // Token detail page lives at /markets/[currency]/[issuer]. Accept
    // `CURRENCY:ISSUER` in a single input — we'll add autocomplete later.
    placeholder: "currency:issuer (e.g., USD:rXXX…)",
    route: (input) => {
      const trimmed = input.trim();
      const [rawCurrency, rawIssuer] = trimmed.split(":");
      if (!rawCurrency || !rawIssuer) return null;
      const currency = rawCurrency.trim();
      const issuer = rawIssuer.trim();
      if (!currency || !isAddress(issuer)) return null;
      return `/markets/${encodeURIComponent(currency)}/${issuer}`;
    },
  },
  collection: {
    id: "collection",
    label: "NFT Collection",
    placeholder: "issuer:taxon (e.g., rXXX…:42)",
    route: (input) => {
      const trimmed = input.trim();
      const [rawIssuer, rawTaxon] = trimmed.split(":");
      if (!rawIssuer || rawTaxon === undefined) return null;
      const issuer = rawIssuer.trim();
      const taxon = rawTaxon.trim();
      if (!isAddress(issuer) || !isUint(taxon)) return null;
      return `/nft/collection/${issuer}/${taxon}`;
    },
  },
  ledger: {
    id: "ledger",
    label: "Ledger",
    placeholder: "Enter ledger index or hash",
    route: (input) => {
      const trimmed = input.trim();
      if (isUint(trimmed) || is64Hex(trimmed)) {
        return `/ledger/${trimmed}`;
      }
      return null;
    },
  },
};

/** Display order in the dropdown — most-used first. */
export const SEARCH_TYPE_ORDER: SearchType[] = [
  "account",
  "transaction",
  "nft",
  "token",
  "collection",
  "ledger",
];
