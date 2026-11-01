/**
 * Gateways, URL safety and auto-load hosts for NFT metadata and images,
 * which the browser loads directly (`nft-media.ts`).
 *
 * IPFS URIs (ipfs://, Qm…, bafy…) are rewritten to the gateways below;
 * any other URL must pass `isAllowedUrl`, and loads without a click only
 * from an `isAutoLoadHost` host.
 */

/** IPFS gateways to try in order (metadata and images share this list).
 *  Reordered + extended 2026-05-09:
 *   - `gateway.pinata.cloud` first — Pinata pins a huge fraction of
 *     XRPL NFT metadata (xrp.cafe, OnChain Marketplace, and most
 *     direct-mint workflows pin to Pinata). It's slower than the
 *     Protocol Labs gateways (3–10s typical) but reliably serves what
 *     they 504 / 301-into-the-void on. Added after Tim's Pixel Ape
 *     Rowboat Club metadata was found alive on Pinata while every
 *     other gateway returned 504/timeout.
 *   - `dweb.link` next (Protocol Labs).
 *   - `ipfs.io` last — historical fallback, increasingly slow but
 *     still serves cold CIDs the others don't have.
 *   - `cloudflare-ipfs.com` removed — Cloudflare retired their public
 *     gateway in late 2024.
 *   - `nftstorage.link` removed 2026-10-28 — it only 302s to ipfs.io,
 *     without CORS headers, so browser metadata fetches always failed. */
export const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
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

/**
 * Non-gateway hosts NFT media loads from without asking. Any other host
 * waits for a "Load from <host>" click: the browser fetches it
 * directly, so the host sees the visitor's IP address.
 *
 * Each entry is an established XRPL project's own host, seen in real
 * mainnet NFT URIs. Add one only with the same evidence.
 *   - `static.expo2025-dwnft.com`: Expo 2025 Osaka NFTs. 134k of 213k
 *     metadata fetches in the 2026-05-08 production audit.
 *   - `mainnet.xrpdomains.xyz`: XRP Domains name NFTs. Seen in a
 *     2026-10-28 sample of about 770 mainnet NFTs.
 */
const TRUSTED_MEDIA_HOSTS = new Set(["static.expo2025-dwnft.com", "mainnet.xrpdomains.xyz"]);

const GATEWAY_HOSTS = new Set(
  [...IPFS_GATEWAYS, ...ARWEAVE_GATEWAYS].map((gateway) => new URL(gateway).hostname),
);

/** Whether NFT media may load from `hostname` without asking: one of
 *  our gateways or a trusted host. */
export function isAutoLoadHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return GATEWAY_HOSTS.has(host) || TRUSTED_MEDIA_HOSTS.has(host);
}

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
 * Reject URLs that name a private, loopback or link-local address, or a
 * known cloud-metadata host, so NFT metadata can't point a visitor's
 * browser at their own network by address. Anything else over HTTPS on
 * port 443 is allowed.
 *
 * Limits: this only reads the URL text. A public name that resolves to a
 * private address, or a redirect to one, still gets through, and `fetch`
 * can't fully prevent that: `redirect: "manual"` hides the target, and
 * `redirect: "error"` would break dweb.link's redirect to its subdomain
 * gateway. Chrome's Private Network Access checks cover part of the gap.
 *
 * Why this isn't an allowlist: NFT issuers host metadata anywhere
 * (custom CDNs, S3 buckets, marketplace APIs, project domains). A
 * 2026-05-08 audit of the old ~30-host allowlist found 145k of 213k
 * metadata fetches (68%) failing it, 134k from one legitimate issuer
 * host. So this gate only refuses unsafe targets; `isAutoLoadHost`
 * decides which safe ones load without a click.
 *
 * Fetches stay bounded (12 s per attempt, 20 s total, 512 KB body,
 * credentials omitted, loose Zod parse of the response).
 */

/** Hostnames that are explicitly dangerous regardless of resolution. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

/** TLD-style suffixes that signal internal-only resolvers. */
const BLOCKED_TLDS = [".internal", ".local", ".localhost"];

type IPv4 = [number, number, number, number];

/** Dotted quad only: `URL` already rewrites `0x7f.1`, `2130706433` and
 *  the like into this form. */
function parseIPv4(s: string): IPv4 | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((p) => p > 255)) return null;
  return parts as IPv4;
}

function isPrivateIPv4([a, b]: IPv4): boolean {
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

/** Eight 16-bit groups, or null. Takes `::` compression and a dotted
 *  IPv4 tail. */
export function parseIPv6(s: string): number[] | null {
  let text = s.replace(/^\[|\]$/g, "").toLowerCase();
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const v4 = parseIPv4(dotted[2]);
    if (!v4) return null;
    text = `${dotted[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part ? part.split(":") : []);
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/** The IPv4 address in the low 32 bits. */
const embeddedV4 = (g: number[]): IPv4 => [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];

function isPrivateIPv6(g: number[]): boolean {
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(6)) return true; // ::/96: unspecified, loopback, IPv4-compatible
  if (zeroUpTo(5) && g[5] === 0xffff) return isPrivateIPv4(embeddedV4(g)); // ::ffff:0:0/96 IPv4-mapped
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // 64:ff9b::/96 NAT64 maps public IPv4; 64:ff9b:1::/48 is local-use.
    return g[2] !== 0 || isPrivateIPv4(embeddedV4(g));
  }
  if (g[0] === 0x2002) return isPrivateIPv4([g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function isPrivateOrLoopback(hostname: string): boolean {
  const v4 = parseIPv4(hostname);
  if (v4) return isPrivateIPv4(v4);
  if (hostname.includes(":")) {
    const v6 = parseIPv6(hostname);
    return v6 === null || isPrivateIPv6(v6);
  }
  return false;
}

/**
 * Returns true when the URL is safe to load. Catches:
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

    // `localhost.` is `localhost`: a trailing dot only marks the name
    // as fully qualified.
    const host = u.hostname.toLowerCase().replace(/\.+$/, "");
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
