// No `server-only` import — the collection-resolver cron
// (`scripts/run-collection-resolver.ts`) imports `resolveCollectionFromToml`
// via tsx, outside the Next.js runtime. The `xrplClient` + `fetch` paths
// are Node-only so this file won't accidentally end up in a client bundle.
import { parse as parseToml } from "smol-toml";
import { xrplClient } from "./xrpl-client";
import type { AccountInfoResponse } from "@/types/xrpl-responses";
import { LRUCache } from "./cache";
import { getCuratedTokenIcon } from "@/data/curated-token-icons";
import logger from "./logger";

const log = logger.child({ module: "xls-26-toml" });

/**
 * XLS-26 / xrp-ledger.toml resolver.
 *
 * XRPL's community spec: issuers publish a TOML file at
 * `https://{domain}/.well-known/xrp-ledger.toml` where `domain` is the
 * hex-decoded `Domain` field on their AccountRoot. The TOML contains
 * [[TOKENS]] entries with metadata (name, desc, icon URL, etc.) for each
 * token they issue.
 *
 * This file:
 * - resolveIssuerDomain(issuer)  — fetch the issuer's Domain from rippled
 * - fetchIssuerToml(domain)       — GET + parse the TOML with guardrails
 * - findTokenEntry(toml, currency, issuer) — match currency/issuer to a
 *                                             [[TOKENS]] entry
 * - resolveTokenIcon(currency, issuer) — one-shot: returns the icon URL
 *                                        for a token, or null
 *
 * Failure modes are many (missing Domain, DNS fail, 404, malformed TOML,
 * no matching token entry). All return null — caller decides what to do.
 */

const FETCH_TIMEOUT_MS = 5_000;
const MAX_TOML_BYTES = 256 * 1024; // 256KB — plenty for legit TOMLs

/**
 * Hex-decode an XRPL Domain field and normalize it into a bare hostname.
 *
 * Issuers populate the Domain field with all sorts of formats — bare
 * hostnames (`example.com`), URLs with scheme + trailing slash
 * (`https://example.com/`), URLs with paths (`example.com/foo`), Twitter
 * handles (`@xyz`), descriptions (`my project`). We strip the URL chrome
 * and validate the remaining hostname.
 *
 * Audit on 2026-05-08 found ~7% of no-icon tokens had a parseable Domain
 * that the previous strict regex was rejecting because of an embedded
 * scheme or trailing slash.
 */
function hexToDomain(hex: string): string | null {
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    let decoded = new TextDecoder().decode(bytes).trim();
    if (!decoded) return null;

    // Strip a scheme prefix if present (`https://`, `http://`, plain `//`).
    decoded = decoded.replace(/^https?:\/\//i, "").replace(/^\/\//, "");

    // Strip everything from the first `/` onwards — we only want the
    // hostname, not whatever path the issuer pasted in.
    const firstSlash = decoded.indexOf("/");
    if (firstSlash >= 0) decoded = decoded.slice(0, firstSlash);

    // Strip a `:port` suffix — issuers occasionally include one.
    const colonIdx = decoded.indexOf(":");
    if (colonIdx >= 0) decoded = decoded.slice(0, colonIdx);

    decoded = decoded.toLowerCase().trim();

    // Validate the hostname:
    //   - non-empty after stripping
    //   - allowed chars only (alphanumerics, dot, hyphen)
    //   - has at least one `.` (rules out single-word handles like
    //     "@BNB_XRP" or "myproject")
    //   - hyphen not at start/end of any label
    if (!decoded) return null;
    if (!/^[a-z0-9.\-]+$/.test(decoded)) return null;
    if (!decoded.includes(".")) return null;
    if (decoded.split(".").some((label) => !label || label.startsWith("-") || label.endsWith("-"))) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function resolveIssuerDomain(issuer: string): Promise<string | null> {
  try {
    const info = (await xrplClient.getAccountInfo(issuer)) as AccountInfoResponse;
    const hex = info.account_data.Domain;
    if (!hex) return null;
    return hexToDomain(hex);
  } catch {
    return null;
  }
}

interface TokenEntry {
  currency?: string;
  issuer?: string;
  name?: string;
  desc?: string;
  icon?: string;
  [key: string]: unknown;
}

/** [[NFTS]] entry — community-driven extension of XLS-26 (no formal spec
 *  yet, but multiple issuers + tools have converged on this shape).
 *  Common shapes:
 *
 *    [[NFTS]]
 *    issuer = "rD..."
 *    taxon  = 0
 *    name   = "Bored Apes XRP"
 *    icon   = "https://..."
 *
 *  Some publishers nest into [[COLLECTIONS]] instead — we accept both. */
interface NftCollectionEntry {
  issuer?: string;
  taxon?: number | string;
  name?: string;
  desc?: string;
  description?: string;
  icon?: string;
  image?: string;
  [key: string]: unknown;
}

interface TomlDoc {
  ISSUERS?: Array<{ account?: string; name?: string; icon?: string }>;
  TOKENS?: TokenEntry[];
  /** Two spellings observed in the wild; we check both. */
  NFTS?: NftCollectionEntry[];
  COLLECTIONS?: NftCollectionEntry[];
  [key: string]: unknown;
}

async function fetchIssuerToml(domain: string): Promise<TomlDoc | null> {
  const url = `https://${domain}/.well-known/xrp-ledger.toml`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      // Sidestep aggressive caches — TOMLs change rarely but we want fresh
      // data on each backfill run.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_TOML_BYTES) {
      log.warn({ domain, bytes: text.length }, "toml too large, ignoring");
      return null;
    }
    return parseToml(text) as TomlDoc;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const HEX40_RE = /^[A-Fa-f0-9]{40}$/;
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;

/**
 * Match a TOML [[TOKENS]] `currency` value against the on-ledger `currency`.
 *
 * XRPL encodes 4+ char tickers as 40-char uppercase hex on-ledger, preserving
 * input case — "SOLO" → 534F4C4F00…, "Solo" → 536F6C6F00…. TOMLs typically
 * list the human-readable ticker ("SOLO"), not the hex form. The previous
 * logic compared uppercased strings directly, so "534F4C4F00…" never matched
 * "SOLO" and icon resolution failed for nearly every 4+ char token.
 *
 * This matcher handles the four real cases:
 *   1. Direct equality (identical strings — fast path, works for 3-char + hex).
 *   2. Both hex, differing case (hex digits are case-equivalent).
 *   3. Both 3-char ASCII, differing case (many TOMLs write "usd" for "USD";
 *      XRPL is technically case-sensitive but issuers almost never ship
 *      conflicting case variants, so permissive match is safer).
 *   4. TOML ASCII ticker + on-ledger hex — encode TOML's value preserving
 *      case ("SOLO" != "Solo"), compare against on-ledger hex.
 */
function currencyMatches(tomlCurrency: string, onLedgerCurrency: string): boolean {
  if (tomlCurrency === onLedgerCurrency) return true;

  if (HEX40_RE.test(tomlCurrency) && HEX40_RE.test(onLedgerCurrency)) {
    return tomlCurrency.toUpperCase() === onLedgerCurrency.toUpperCase();
  }

  if (tomlCurrency.length === 3 && onLedgerCurrency.length === 3) {
    return tomlCurrency.toUpperCase() === onLedgerCurrency.toUpperCase();
  }

  if (
    tomlCurrency.length >= 1 &&
    tomlCurrency.length <= 20 &&
    PRINTABLE_ASCII_RE.test(tomlCurrency) &&
    HEX40_RE.test(onLedgerCurrency)
  ) {
    const hex = Buffer.from(tomlCurrency, "ascii")
      .toString("hex")
      .toUpperCase()
      .padEnd(40, "0");
    if (hex === onLedgerCurrency.toUpperCase()) return true;
  }

  return false;
}

function findTokenEntry(
  toml: TomlDoc,
  currency: string,
  issuer: string,
): TokenEntry | null {
  const tokens = toml.TOKENS ?? [];
  for (const entry of tokens) {
    if (!entry.currency) continue;
    if (!currencyMatches(entry.currency, currency)) continue;
    // Some TOMLs omit issuer (implicit self). If present, require match.
    if (entry.issuer && entry.issuer !== issuer) continue;
    return entry;
  }
  return null;
}

// Short-lived per-issuer TOML cache. Bursts of new tokens from the same
// issuer (common: Gatehub, Sologenic, Bitstamp ship many tokens each) would
// otherwise re-fetch the same TOML dozens of times within one ingestion
// window. Caches null results too so we don't retry dead domains for an hour.
const issuerTomlCache = new LRUCache<TomlDoc | null>(500, 60 * 60 * 1000);

export async function getIssuerTomlCached(issuer: string): Promise<TomlDoc | null> {
  if (issuerTomlCache.has(issuer)) return issuerTomlCache.get(issuer) ?? null;
  const domain = await resolveIssuerDomain(issuer);
  if (!domain) {
    issuerTomlCache.set(issuer, null);
    return null;
  }
  const toml = await fetchIssuerToml(domain);
  issuerTomlCache.set(issuer, toml);
  return toml;
}

/**
 * Look up an NFT collection by `(issuer, taxon)` in the issuer's TOML.
 *
 * Returns name + image when an entry matches, null otherwise. Accepts
 * both `[[NFTS]]` and `[[COLLECTIONS]]` array spellings (community
 * has converged on these two; both seen in the wild). Some entries
 * omit the `issuer` key (implicit self) — we match on taxon alone in
 * that case.
 *
 * Used by the collection-resolver cron (`scripts/run-collection-resolver.ts`)
 * as one of its layers. Sub-100ms with the LRU cache hit; <1s for a
 * fresh issuer fetch over the network.
 */
export async function resolveCollectionFromToml(
  issuer: string,
  taxon: number,
): Promise<{ name: string; imageUrl: string | null } | null> {
  const toml = await getIssuerTomlCached(issuer);
  if (!toml) return null;
  const entries = [
    ...(toml.NFTS ?? []),
    ...(toml.COLLECTIONS ?? []),
  ];
  for (const entry of entries) {
    // Issuer match: explicit value must equal, missing means "implicit
    // self" (covered by the fact that we already fetched FROM the issuer's
    // domain — if it published the entry, it's authoritative).
    if (entry.issuer && entry.issuer !== issuer) continue;
    // Taxon may be number or string in the TOML.
    const entryTaxon =
      typeof entry.taxon === "number"
        ? entry.taxon
        : typeof entry.taxon === "string"
          ? Number(entry.taxon)
          : NaN;
    if (!Number.isFinite(entryTaxon) || entryTaxon !== taxon) continue;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) continue;
    const rawIcon =
      typeof entry.icon === "string"
        ? entry.icon
        : typeof entry.image === "string"
          ? entry.image
          : null;
    const imageUrl =
      rawIcon && /^https?:\/\//.test(rawIcon) ? rawIcon : null;
    return { name, imageUrl };
  }
  return null;
}

/**
 * Resolve a token's icon URL. Tries sources in order and returns the
 * first non-null match:
 *
 *   1. XLS-26 TOML at the issuer's Domain (the canonical, owner-
 *      controlled source).
 *   2. Hand-curated registry in `src/data/curated-token-icons.ts` (for
 *      tokens whose issuer has no Domain, or whose Domain TOML has no
 *      `icon` field — the long tail).
 *
 * Returns null when every source comes up empty.
 */
export async function resolveTokenIcon(
  currency: string,
  issuer: string,
): Promise<string | null> {
  // 1. XLS-26 TOML
  const toml = await getIssuerTomlCached(issuer);
  if (toml) {
    const entry = findTokenEntry(toml, currency, issuer);
    const icon = entry?.icon ?? null;
    if (icon && typeof icon === "string" && /^https?:\/\//.test(icon)) {
      return icon;
    }
  }

  // 2. Hand-curated fallback
  const curated = getCuratedTokenIcon(currency, issuer);
  if (curated && /^https:\/\//.test(curated)) {
    return curated;
  }

  return null;
}
