import type { SearchType } from "@/types/search";

export const XRPL_EPOCH = 946684800; // 2000-01-01T00:00:00Z in Unix seconds

/** Regex to validate an XRPL classic r-address (25–34 chars, base58 alphabet). */
export const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,33}$/;

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
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,33}[\s:]+(?:dt[\s:]*)?(\d+)$/i.test(trimmed))
    return "account-dt";

  // Classic r-address (base58check validated)
  if (XRPL_ADDRESS_RE.test(trimmed)) return "account";

  // X-address (46 chars starting with X)
  if (trimmed.startsWith("X") && trimmed.length === 46) return "x-address";

  // CTID: 16-char hex starting with C (Compact Transaction ID)
  if (/^C[0-9A-Fa-f]{15}$/i.test(trimmed)) return "ctid";

  // 40-char hex → currency hash (non-standard currency code)
  if (/^[A-Fa-f0-9]{40}$/.test(trimmed)) return "currency-hash";

  // 64-char hex → ambiguous (NFT ID, tx hash, or ledger object)
  if (/^[A-Fa-f0-9]{64}$/.test(trimmed)) return "hex64";

  // PayString format: user$domain.com
  if (/^[^$]+\$[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed))
    return "paystring";

  // 3-char uppercase alphabetic → standard currency code (USD, EUR, etc.)
  if (/^[A-Z]{3}$/.test(trimmed)) return "currency-code";

  return "unknown";
}

/**
 * Parse "rAddress:12345" or "rAddress DT:12345" into { address, dt }.
 * Returns null if the input doesn't match the account-dt pattern.
 */
export function parseAddressDT(input: string): { address: string; dt: number } | null {
  const match = input.trim().match(/^(r[1-9A-HJ-NP-Za-km-z]{24,33})[\s:]+(?:dt[\s:]*)?(\d+)$/i);
  if (!match) return null;
  const dt = parseInt(match[2], 10);
  if (!Number.isFinite(dt) || dt < 0 || dt > 4294967295) return null;
  return { address: match[1], dt };
}

const TYPE_COLOR_MAP: Record<string, string> = {
  Payment: "#6CB4EE",
  OfferCreate: "#E8B44C",
  OfferCancel: "#E8B44C",
  NFTokenMint: "#A78BFA",
  NFTokenBurn: "#A78BFA",
  NFTokenCreateOffer: "#A78BFA",
  NFTokenAcceptOffer: "#A78BFA",
  NFTokenCancelOffer: "#A78BFA",
  TrustSet: "#4ADE80",
  AMMCreate: "#F472B6",
  AMMDeposit: "#F472B6",
  AMMWithdraw: "#F472B6",
  AMMVote: "#F472B6",
  AMMBid: "#F472B6",
  AMMDelete: "#F472B6",
  EscrowCreate: "#FB923C",
  EscrowFinish: "#FB923C",
  EscrowCancel: "#FB923C",
  AccountSet: "#94A3B8",
  AccountDelete: "#94A3B8",
  SetRegularKey: "#94A3B8",
  SignerListSet: "#94A3B8",
  CheckCreate: "#F87171",
  CheckCash: "#F87171",
  CheckCancel: "#F87171",
  PaymentChannelCreate: "#F87171",
  PaymentChannelClaim: "#F87171",
  PaymentChannelFund: "#F87171",
  DepositPreauth: "#94A3B8",
  DIDSet: "#94A3B8",
  DIDDelete: "#94A3B8",
  Clawback: "#94A3B8",
  OracleSet: "#94A3B8",
  OracleDelete: "#94A3B8",
  XChainCreateBridge: "#94A3B8",
  XChainCreateClaimID: "#94A3B8",
  XChainCommit: "#94A3B8",
  XChainClaim: "#94A3B8",
  XChainModifyBridge: "#94A3B8",
  XChainAccountCreateCommit: "#94A3B8",
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

export function getTypeColor(txType: string): string {
  return TYPE_COLOR_MAP[txType] ?? "#6B7280";
}

export function getTypeFamily(txType: string): string {
  return TYPE_FAMILY_MAP[txType] ?? "Other";
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
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

export function formatCompactNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function decodeCurrency(currency: string): string {
  if (currency.length <= 3) return currency;
  try {
    const decoded = Buffer.from(currency, "hex")
      .toString("utf8")
      .replace(/\0/g, "");
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
    return Buffer.from(input, "ascii")
      .toString("hex")
      .toUpperCase()
      .padEnd(40, "0");
  }
  // Anything else: pass through (caller decides).
  return input;
}
