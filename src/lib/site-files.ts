/**
 * Files written next to the app at build time by the site-files plugin
 * in vite.config.ts: robots.txt, sitemap.xml, llms.txt, the web manifest,
 * and Cloudflare's `_headers` and `_redirects`.
 */
import { allDocSlugs } from "@/routes/docs/nav";
import { GROUND } from "@/lib/brand-colors";
import { SHARE_DESCRIPTION, SITE_TITLE } from "@/lib/meta";
import { DEFAULT_SITE_URL } from "@/lib/site-url";
import { CF_BEACON_SRC } from "@/lib/web-analytics";
import { XRPL_NODES } from "@/lib/xrpl-socket";

/** The build's VITE_ env, as Vite resolved it for this mode. */
export interface SiteFileEnv {
  VITE_SITE_URL?: string;
  /** The CSP allows the relay's origin when set. */
  VITE_LIVE_RELAY_URL?: string;
  /** The CSP allows Cloudflare's analytics script when set. */
  VITE_CF_BEACON_TOKEN?: string;
}

/**
 * Pure training crawlers: bots that feed LLM training sets and have no
 * live search or answer surface. AI search bots (OAI-SearchBot,
 * ChatGPT-User, PerplexityBot, YouBot, Meta-ExternalFetcher,
 * Google-Extended, Applebot-Extended, Amazonbot) stay allowed so Sonde
 * shows up in AI answers.
 */
const AI_TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "Diffbot",
  "ImagesiftBot",
  "img2dataset",
  "omgili",
  "SemanticScholarBot",
  "AI2Bot",
  "Magpie-Crawler",
  "Meta-ExternalAgent",
];

export function robotsTxt(siteUrl: string): string {
  const blocks = [
    "User-Agent: *\nAllow: /\nDisallow: /designsystem",
    ...AI_TRAINING_BOTS.map((bot) => `User-Agent: ${bot}\nDisallow: /`),
    `Sitemap: ${siteUrl}/sitemap.xml`,
  ];
  return `${blocks.join("\n\n")}\n`;
}

/**
 * "Last meaningful update" for every entry. A fixed date beats the build
 * time: search engines discount lastmod values that always say "now".
 * Bump it after a real content sweep.
 */
const SITE_LAST_UPDATED = "2026-05-05T00:00:00.000Z";

type ChangeFreq = "always" | "hourly" | "monthly";

const SITEMAP_PAGES: Array<[path: string, changefreq: ChangeFreq, priority: number]> = [
  ["/", "always", 1],
  ["/network", "hourly", 0.8],
  ["/support", "monthly", 0.5],
  ["/docs", "monthly", 0.6],
  ...allDocSlugs.map((slug): [string, ChangeFreq, number] => [`/docs/${slug}`, "monthly", 0.6]),
];

export function sitemapXml(siteUrl: string): string {
  const urls = SITEMAP_PAGES.map(
    ([path, changefreq, priority]) =>
      `<url>\n<loc>${path === "/" ? siteUrl : siteUrl + path}</loc>\n<lastmod>${SITE_LAST_UPDATED}</lastmod>\n<changefreq>${changefreq}</changefreq>\n<priority>${priority}</priority>\n</url>\n`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("")}</urlset>\n`;
}

/**
 * The llmstxt.org summary for AI search and answer engines. The reader is
 * an LLM making a quick routing call: say what Sonde is, what it covers,
 * and where to look.
 */
function llmsTxt(siteUrl: string): string {
  return `# Sonde

Sonde is a free, easy-to-read explorer for the XRP Ledger (XRPL). It
reads live data from public XRPL nodes and shows accounts, transactions,
ledgers, NFTs and network health, laid out to be easy to understand.

The product is hosted at ${siteUrl}.

## What Sonde knows

- XRPL transactions of every type (Payments, OfferCreate / OfferCancel,
  TrustSet, AMM Deposit/Withdraw/Vote, NFT Mint/Burn/Trade, escrows,
  payment channels, MPTokens, more), explained in plain English.
- Live ledger state: account balances, trustlines, NFT holdings,
  AMM positions, escrows, payment channels, MPToken issuances.
- Network status: live ledger closes, fees, and amendment voting.

## Key URLs

- ${siteUrl} — landing; hero stats, network activity, feature overview
- ${siteUrl}/network — live network activity and amendment status
- ${siteUrl}/nft/{nftokenId} — per-NFT detail
- ${siteUrl}/account/{rAddress} — per-account detail: balances, transactions,
  trustlines, NFTs, AMM positions, ancestry
- ${siteUrl}/token/{CODE.rIssuer or mptIssuanceId} — per-token detail:
  issuer, supply, XRP pool price, flags
- ${siteUrl}/tx/{txHash} — per-transaction detail
- ${siteUrl}/ledger/{ledgerIndex} — per-ledger detail

## Data depth and limits

Sonde reads public XRPL nodes directly, so ledger state is always
current. Transaction history goes as far back as the connected node
keeps.

## Pricing

Sonde is free and needs no account.

## Sitemap

${siteUrl}/sitemap.xml lists every public page including all docs. Dynamic
per-entity URLs (account / tx / ledger / NFT / token detail pages) are not enumerated in the sitemap due to
volume but are crawlable via in-app links and the global search bar
in the top navigation.

## Brand

Built and operated by Timothy Ali (https://timothyali.com).
Twitter / X: @sonde_xrpl.
`;
}

export function webManifest(): string {
  return JSON.stringify({
    name: SITE_TITLE,
    short_name: "Sonde",
    description: SHARE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: GROUND.dark,
    theme_color: GROUND.dark,
    // The mark sits inside the maskable safe circle (`app-icon.test.ts`),
    // so the same files serve both purposes.
    icons: ["any", "maskable"].flatMap((purpose) =>
      [192, 512].map((size) => ({
        src: `/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose,
      })),
    ),
  });
}

export interface CspOptions {
  relayUrl?: string;
  /** Cloudflare Web Analytics is on (`VITE_CF_BEACON_TOKEN` is set). */
  webAnalytics?: boolean;
}

export function contentSecurityPolicy({ relayUrl, webAnalytics }: CspOptions = {}): string {
  const relayOrigin = relayUrl ? ` ${new URL(relayUrl).origin}` : "";
  const beacon = webAnalytics ? ` ${new URL(CF_BEACON_SRC).origin}` : "";
  const xrplNodes = [...XRPL_NODES].sort().join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${beacon}`,
    "style-src 'self' 'unsafe-inline'",
    // `data:` because PARC Pixel (under Vite's 4 KB inline limit) ships
    // inside the CSS as data: URIs, so it paints with the stylesheet.
    "font-src 'self' data:",
    "img-src 'self' data: https: blob:",
    // `https:` because NFT metadata is fetched from the browser and lives
    // on arbitrary hosts (IPFS gateways, issuer CDNs). It also covers the
    // analytics beacon's reports to cloudflareinsights.com and the price
    // chart's candles from Bitstamp and Kraken.
    `connect-src 'self'${relayOrigin} https: ${xrplNodes}`,
    "frame-src 'self'",
    "child-src 'self'",
    "frame-ancestors 'self' https://timothyali.com https://*.timothyali.com",
  ].join("; ");
}

/** Cloudflare `_headers`: security headers on every response, including
 *  the SPA fallback, and long-lived caching for hashed build assets. */
export function headersFile(csp: CspOptions = {}): string {
  const security = [
    "X-Content-Type-Options: nosniff",
    "Referrer-Policy: strict-origin-when-cross-origin",
    "Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security: max-age=63072000; includeSubDomains; preload",
    "X-Frame-Options: SAMEORIGIN",
    `Content-Security-Policy: ${contentSecurityPolicy(csp)}`,
  ];
  return [
    "/*",
    ...security.map((h) => `  ${h}`),
    "",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n");
}

/** Cloudflare `_redirects`. /home was briefly the landing route; old
 *  bookmarks still land on /. */
function redirectsFile(): string {
  return "/home / 301\n";
}

/** Every generated file, keyed by its path under the build output. */
export function siteFiles(env: SiteFileEnv): Record<string, string> {
  const siteUrl = env.VITE_SITE_URL || DEFAULT_SITE_URL;
  const relayUrl = env.VITE_LIVE_RELAY_URL || undefined;
  const webAnalytics = Boolean(env.VITE_CF_BEACON_TOKEN);
  return {
    "robots.txt": robotsTxt(siteUrl),
    "sitemap.xml": sitemapXml(siteUrl),
    "llms.txt": llmsTxt(siteUrl),
    "manifest.webmanifest": webManifest(),
    _headers: headersFile({ relayUrl, webAnalytics }),
    _redirects: redirectsFile(),
  };
}
