import { isValidXAddress } from "ripple-address-codec";
import { asciiToHex, hexToUtf8 } from "./hex";
import type { SearchType } from "@/types/search";

export const XRPL_EPOCH = 946684800; // 2000-01-01T00:00:00Z in Unix seconds

/**
 * XRPL's base58 alphabet (same 58 characters as Bitcoin's, different order).
 * Excludes 0, O, I and l. Case-sensitive: never combine with the `i` flag.
 */
const XRPL_BASE58 = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

/**
 * Classic r-address body: `r` + 24–33 base58 chars (25–34 total). A 25-byte
 * payload with a 0x00 version byte encodes to at most 34 chars. Shape check
 * only; no checksum.
 */
const ADDRESS_SRC = `r[${XRPL_BASE58}]{24,33}`;

/** Regex to validate the shape of an XRPL classic r-address (25–34 chars, base58 alphabet). */
export const XRPL_ADDRESS_RE = new RegExp(`^${ADDRESS_SRC}$`);

/**
 * "rAddress:12345", "rAddress DT:12345", "rAddress dt 12345". Only the `dt`
 * keyword is case-insensitive; the address part must stay case-sensitive.
 */
const ADDRESS_DT_RE = new RegExp(`^(${ADDRESS_SRC})[\\s:]+(?:[dD][tT][\\s:]*)?(\\d+)$`);

export function dropsToXrp(drops: string | number): string {
  try {
    const str =
      typeof drops === "string"
        ? drops.split(".")[0]
        : Math.floor(drops).toString();
    const d = BigInt(str);
    if (d < 0n) return `-${dropsToXrp((-d).toString())}`;
    const whole = d / 1000000n;
    const frac = d % 1000000n;
    const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return "0";
  }
}

const TF_PARTIAL_PAYMENT = 0x00020000;

/** The tx and meta fields `deliveredAmount` reads. */
interface DeliveryTx {
  TransactionType?: unknown;
  Amount?: unknown;
  DeliverMax?: unknown;
  Flags?: unknown;
}
interface DeliveryMeta {
  delivered_amount?: unknown;
  DeliveredAmount?: unknown;
}

/**
 * What a tx actually moved. A Payment's `Amount` is only its ceiling: with
 * tfPartialPayment it can deliver far less, and trusting `Amount` is the
 * classic partial-payment exploit. Prefers the delivered amount, else
 * `Amount` (`DeliverMax` in API v2) for types and failures that have none.
 * Undefined when a partial payment's delivery is unknown: pre-2014
 * "unavailable", or no meta.
 */
export function deliveredAmount(tx: DeliveryTx, meta: DeliveryMeta | undefined): unknown {
  const delivered = meta?.delivered_amount ?? meta?.DeliveredAmount;
  if (delivered !== undefined && delivered !== "unavailable") return delivered;
  const flags = typeof tx.Flags === "number" ? tx.Flags : 0;
  if (tx.TransactionType === "Payment" && (flags & TF_PARTIAL_PAYMENT) !== 0) return undefined;
  return tx.Amount ?? tx.DeliverMax;
}

/** `deliveredAmount` in XRP drops; undefined for issued tokens. */
export function deliveredDrops(tx: DeliveryTx, meta: DeliveryMeta | undefined): string | undefined {
  const amount = deliveredAmount(tx, meta);
  return typeof amount === "string" ? amount : undefined;
}

export function truncate(str: string, chars = 5): string {
  if (str.length <= chars * 2 + 3) return str;
  return `${str.slice(0, chars)}...${str.slice(-chars)}`;
}

// Aliases kept for call-site compatibility
export const truncateAddress = truncate;
export const truncateHash = truncate;

export function detectSearchType(input: string): SearchType {
  const trimmed = input.trim();

  // Pure digits → ledger index
  if (/^\d+$/.test(trimmed)) return "ledger";

  // Account + destination tag: "rAddress:12345", "rAddress DT:12345", "rAddress dt 12345"
  if (ADDRESS_DT_RE.test(trimmed)) return "account-dt";

  // Classic r-address (alphabet + length only, no checksum)
  if (XRPL_ADDRESS_RE.test(trimmed)) return "account";

  // Mainnet X-address (XLS-5d, 47 chars, "X" prefix), checksum-validated.
  // Testnet X-addresses ("T" prefix) are rejected: this is a mainnet explorer.
  if (trimmed.startsWith("X") && isValidXAddress(trimmed)) return "x-address";

  // CTID: 16-char hex starting with C (Compact Transaction ID)
  if (/^C[0-9A-Fa-f]{15}$/i.test(trimmed)) return "ctid";

  // 64-char hex → ambiguous (NFT ID, tx hash, or ledger object)
  if (/^[A-Fa-f0-9]{64}$/.test(trimmed)) return "hex64";

  // PayString format: user$domain.com
  if (/^[^$]+\$[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed))
    return "paystring";

  return "unknown";
}

/**
 * Parse "rAddress:12345" or "rAddress DT:12345" into { address, dt }.
 * Returns null if the input doesn't match the account-dt pattern.
 */
export function parseAddressDT(input: string): { address: string; dt: number } | null {
  const match = input.trim().match(ADDRESS_DT_RE);
  if (!match) return null;
  const dt = parseInt(match[2], 10);
  if (!Number.isFinite(dt) || dt < 0 || dt > 4294967295) return null;
  return { address: match[1], dt };
}

/** Colour families for tx types. Each one has a `--color-tx-<key>` hue, a
 *  `-fg` text token and a `-mark` token in globals.css. */
export const TX_COLOR_KEYS = [
  "payment",
  "offer",
  "nft",
  "trust",
  "amm",
  "escrow",
  "account",
  "check",
  "other",
] as const;
export type TxColorKey = (typeof TX_COLOR_KEYS)[number];

const TYPE_COLOR_KEY: Record<string, TxColorKey> = {
  Payment: "payment",
  OfferCreate: "offer",
  OfferCancel: "offer",
  NFTokenMint: "nft",
  NFTokenBurn: "nft",
  NFTokenCreateOffer: "nft",
  NFTokenAcceptOffer: "nft",
  NFTokenCancelOffer: "nft",
  TrustSet: "trust",
  AMMCreate: "amm",
  AMMDeposit: "amm",
  AMMWithdraw: "amm",
  AMMVote: "amm",
  AMMBid: "amm",
  AMMDelete: "amm",
  EscrowCreate: "escrow",
  EscrowFinish: "escrow",
  EscrowCancel: "escrow",
  AccountSet: "account",
  AccountDelete: "account",
  SetRegularKey: "account",
  SignerListSet: "account",
  CheckCreate: "check",
  CheckCash: "check",
  CheckCancel: "check",
  PaymentChannelCreate: "check",
  PaymentChannelClaim: "check",
  PaymentChannelFund: "check",
  DepositPreauth: "account",
  DIDSet: "account",
  DIDDelete: "account",
  Clawback: "account",
  OracleSet: "account",
  OracleDelete: "account",
  XChainCreateBridge: "account",
  XChainCreateClaimID: "account",
  XChainCommit: "account",
  XChainClaim: "account",
  XChainModifyBridge: "account",
  XChainAccountCreateCommit: "account",
};

const TYPE_FAMILY_MAP: Record<string, string> = {
  Payment: "Payment",
  OfferCreate: "Offer",
  OfferCancel: "Offer",
  NFTokenMint: "NFToken",
  NFTokenBurn: "NFToken",
  NFTokenCreateOffer: "NFToken",
  NFTokenAcceptOffer: "NFToken",
  NFTokenCancelOffer: "NFToken",
  TrustSet: "Trust Line",
  AMMCreate: "AMM",
  AMMDeposit: "AMM",
  AMMWithdraw: "AMM",
  AMMVote: "AMM",
  AMMBid: "AMM",
  AMMDelete: "AMM",
  EscrowCreate: "Escrow",
  EscrowFinish: "Escrow",
  EscrowCancel: "Escrow",
  AccountSet: "Account",
  AccountDelete: "Account",
  SetRegularKey: "Account",
  SignerListSet: "Account",
  CheckCreate: "Check & Channel",
  CheckCash: "Check & Channel",
  CheckCancel: "Check & Channel",
  PaymentChannelCreate: "Check & Channel",
  PaymentChannelClaim: "Check & Channel",
  PaymentChannelFund: "Check & Channel",
  DepositPreauth: "Account",
  DIDSet: "Account",
  DIDDelete: "Account",
  Clawback: "Account",
  OracleSet: "Oracle",
  OracleDelete: "Oracle",
  XChainCreateBridge: "Cross-Chain",
  XChainCreateClaimID: "Cross-Chain",
  XChainCommit: "Cross-Chain",
  XChainClaim: "Cross-Chain",
  XChainModifyBridge: "Cross-Chain",
  XChainAccountCreateCommit: "Cross-Chain",
};

export function getTypeColorKey(txType: string): TxColorKey {
  return TYPE_COLOR_KEY[txType] ?? "other";
}

/** Each family's `-mark` token. Written out in full: Tailwind only emits
 *  a theme variable it finds by name, so a name built from a template
 *  ships unset on the dark ground. */
const TX_MARKS: Record<TxColorKey, string> = {
  payment: "var(--color-tx-payment-mark)",
  offer: "var(--color-tx-offer-mark)",
  nft: "var(--color-tx-nft-mark)",
  trust: "var(--color-tx-trust-mark)",
  amm: "var(--color-tx-amm-mark)",
  escrow: "var(--color-tx-escrow-mark)",
  account: "var(--color-tx-account-mark)",
  check: "var(--color-tx-check-mark)",
  other: "var(--color-tx-other-mark)",
};

/** The type's colour as a mark (dots, bars), for inline styles: its
 *  `-mark` token, which switches with the theme. Not for text: use
 *  `TypeTag` (or the `-fg` token) there. */
export function getTypeColor(txType: string): string {
  return TX_MARKS[getTypeColorKey(txType)];
}

export function getTypeFamily(txType: string): string {
  return TYPE_FAMILY_MAP[txType] ?? "Other";
}

export function formatDate(rippleTime: number): string {
  const d = new Date((rippleTime + XRPL_EPOCH) * 1000);
  return (
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "UTC",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(d) + " UTC"
  );
}

/**
 * Compact one-line UTC date for tight cells — drops seconds and the
 * "UTC" suffix vs. `formatDate`. Use inside mobile-folded secondary
 * lines (NFT history, account tx, etc.) where the full
 * `2025-07-30 15:10:20 UTC` (~23ch) doesn't fit and would wrap.
 * Format: `2025-07-30 15:10` (16ch).
 */
export function formatDateCompact(rippleTime: number): string {
  const d = new Date((rippleTime + XRPL_EPOCH) * 1000);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function decodeCurrency(currency: string): string {
  if (currency.length <= 3) return currency;
  try {
    const decoded = hexToUtf8(currency).replace(/\0/g, "");
    // Filter out non-printable ASCII characters; fall back to raw hex if empty
    const cleaned = decoded.replace(/[^\x20-\x7E]/g, "").trim();
    return cleaned || currency;
  } catch {
    return currency;
  }
}

/**
 * Normalize a user-facing currency string to its on-ledger canonical
 * form (the same form ClickHouse/Postgres store).
 *
 * XRPL convention:
 *  - 1–3 char ASCII tickers (USD, BTC, SEC) are stored verbatim
 *  - 4+ char tickers (ARMY, BWIF, FARM) are stored as 40-char hex
 *    (UTF-8 bytes followed by zero padding)
 *
 * Token detail pages can land here with either form depending on what
 * the URL or component prop carries — `currency=ARMY` from a
 * display-form path, or `currency=41524D59...` from a hex-form path.
 * Every CH reader that filters by `currency` should normalize first
 * or it'll silently return zero rows for the display form.
 *
 * Inverse of `decodeCurrency`.
 */
export function toLedgerCurrency(input: string): string {
  if (!input) return input;
  // Already in canonical 40-char hex form — leave as-is (uppercased).
  if (input.length === 40 && /^[0-9A-Fa-f]{40}$/.test(input)) {
    return input.toUpperCase();
  }
  // 1–3 char ASCII tickers stay verbatim.
  if (input.length <= 3) return input;
  // 4–20 char printable ASCII → hex-encode + zero-pad to 40.
  if (input.length <= 20 && /^[\x20-\x7E]+$/.test(input)) {
    return asciiToHex(input).padEnd(40, "0");
  }
  // Anything else: pass through (caller decides).
  return input;
}
