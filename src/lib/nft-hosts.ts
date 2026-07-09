/**
 * Shared allowlist of hosts permitted for outbound NFT metadata & image fetches.
 * Used by both /api/nft-metadata and /api/nft-image routes for SSRF protection.
 *
 * IPFS URIs (ipfs://, Qm…, bafy…) are handled separately via gateway fallback
 * and do NOT need to be listed here — only the gateways themselves need entries.
 */

/** IPFS gateways to try in order (metadata + image routes share this list).
 *  Reordered + extended 2026-05-09:
 *   - `gateway.pinata.cloud` first — Pinata pins a huge fraction of
 *     XRPL NFT metadata (xrp.cafe, OnChain Marketplace, and most
 *     direct-mint workflows pin to Pinata). It's slower than the
 *     Protocol Labs gateways (3–10s typical) but reliably serves what
 *     they 504 / 301-into-the-void on. Added after Tim's Pixel Ape
 *     Rowboat Club metadata was found alive on Pinata while every
 *     other gateway returned 504/timeout.
 *   - `dweb.link` + `nftstorage.link` next (Protocol Labs).
 *   - `ipfs.io` last — historical fallback, increasingly slow but
 *     still serves cold CIDs the others don't have.
 *   - `cloudflare-ipfs.com` removed — Cloudflare retired their public
 *     gateway in late 2024. */
export const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
  "https://nftstorage.link/ipfs/",
  "https://ipfs.io/ipfs/",
];

/** Arweave gateways to try in order. `permagate.io` added 2026-05-09
 *  after audit found multiple XRPL NFT collections (RegulatorPunk,
 *  Sologenic-issued drops) had data that arweave.net 404'd on but
 *  permagate.io served correctly — the network gateways are not all
 *  serving the same data. */
const ARWEAVE_GATEWAYS = [
  "https://arweave.net/",
  "https://permagate.io/",
  "https://ar-io.net/",
  "https://g8way.io/",
];

/** Extract the path portion from an Arweave gateway URL, e.g. "IKJtppjME-..." */
export function extractArweavePath(url: string): string | null {
  for (const gw of ARWEAVE_GATEWAYS) {
    if (url.startsWith(gw)) return url.slice(gw.length);
  }
  // Also handle ar:// protocol
  if (url.startsWith("ar://")) return url.slice(5);
  return null;
}

/** Build gateway URLs for an Arweave path */
export function arweaveGatewayUrls(arPath: string): string[] {
  return ARWEAVE_GATEWAYS.map((gw) => `${gw}${arPath}`);
}

/**
 * SSRF protection — reject URLs pointing to private/loopback/link-local
 * networks and known cloud-metadata service hosts. Anything else over
 * HTTPS on port 443 is allowed.
 *
 * Why not a curated host allowlist: NFT issuers host metadata anywhere
 * — custom CDNs, S3 buckets, marketplace APIs, project-owned domains.
 * A static allowlist rejects most of the long tail. Audit on 2026-05-08
 * found 145k of 213k metadata fetches (68%!) were failing the
 * allowlist gate, including 134k from a single legitimate issuer host
 * (`static.expo2025-dwnft.com`).
 *
 * The defense surface is constrained by the existing fetcher limits
 * (8s per-fetch + 15s total timeout, 512KB max body, manual redirect
 * handling, strict Zod parser on response). The remaining SSRF risk
 * is a public-domain hostname resolving to a private IP at fetch time
 * (DNS rebinding) — Sonde's deployment doesn't have credentialed
 * internal services those rebinding attempts could target, so the
 * tradeoff is fine.
 */

/** Hostnames that are explicitly dangerous regardless of resolution. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "169.254.169.254", // AWS / GCP / Azure metadata service literal
]);

/** TLD-style suffixes that signal internal-only resolvers. */
const BLOCKED_TLDS = [".internal", ".local", ".localhost"];

function parseIPv4(s: string): [number, number, number, number] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return parts as [number, number, number, number];
}

function isPrivateOrLoopback(hostname: string): boolean {
  // IPv4 literal — check octets directly.
  const v4 = parseIPv4(hostname);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    return false;
  }

  // IPv6 literal (with or without brackets in URL-style).
  if (hostname.includes(":")) {
    const stripped = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (stripped === "::" || stripped === "::1") return true; // unspecified + loopback
    if (stripped.startsWith("fe80:")) return true; // link-local
    if (stripped.startsWith("fc") || stripped.startsWith("fd")) return true; // fc00::/7 ULA
    return false;
  }

  return false;
}

/**
 * Returns true when the URL is safe to fetch from the server. Catches:
 *   - Non-HTTPS protocols (only `https:` allowed; ipfs:// + ar:// have
 *     their own gateway-rewrite path)
 *   - Embedded credentials (https://user:pass@host)
 *   - Non-default ports (only 443 or unspecified)
 *   - Private / loopback / link-local IP literals
 *   - Cloud metadata service hostnames + literal IP
 *   - `.internal` / `.local` / `.localhost` TLDs
 *
 * Anything else over public HTTPS — including custom NFT issuer
 * domains, S3 buckets, project CDNs — is allowed.
 */
export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== "443") return false;

    const host = u.hostname.toLowerCase();
    if (!host) return false;
    if (BLOCKED_HOSTNAMES.has(host)) return false;
    for (const tld of BLOCKED_TLDS) {
      if (host === tld.slice(1) || host.endsWith(tld)) return false;
    }
    if (isPrivateOrLoopback(host)) return false;

    return true;
  } catch {
    return false;
  }
}
