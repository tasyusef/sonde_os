import { headers } from "next/headers";
import { db } from "@/db";
import { pageViews } from "@/db/schema";
import { createHash } from "crypto";

/** Normalize dynamic route segments to patterns for aggregation. */
function toRoutePattern(route: string): string {
  return route
    .replace(/\/r[a-zA-Z0-9]{20,}[^/]*/g, "/[address]") // XRPL addresses
    .replace(/\/[A-F0-9]{64}/gi, "/[hash]")               // 64-char hex hashes
    .replace(/\/\d{5,}/g, "/[index]")                      // Ledger indexes (5+ digits)
    .replace(/\/[A-F0-9]{56,}/gi, "/[id]");                // NFT IDs
}

/** Hash IP with daily-rotating salt for privacy-preserving unique visitor counting. */
function hashVisitor(ip: string): string {
  const daySalt = (process.env.ANALYTICS_SALT ?? "sonde") + new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(ip + daySalt).digest("hex");
}

/** Hostnames we treat as "internal" (don't store as a referrer — null instead).
 *  Anything ending in one of these is normalized to null so the admin
 *  "Top Referrers" rail only shows actual external sources. */
const INTERNAL_REFERRER_HOSTS = ["sondelab.com", "localhost", "127.0.0.1"];

/**
 * Pull the hostname out of a Referer URL, normalize it, and decide
 * whether it represents an external referrer worth recording.
 *
 *   "https://t.co/abc"            → "t.co"
 *   "https://www.google.com/..."  → "google.com"  (www. stripped)
 *   "https://sondelab.com/..."    → null          (internal nav)
 *   "https://localhost:3000/..."  → null          (dev)
 *   ""  /  null  /  malformed     → null
 */
function parseReferrerHost(referer: string | null): string | null {
  if (!referer) return null;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  if (host.startsWith("www.")) host = host.slice(4);
  if (INTERNAL_REFERRER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return null;
  }
  // Cap length defensively; the column is VARCHAR(100).
  return host.length > 100 ? host.slice(0, 100) : host;
}

/**
 * Bot/scraper signatures. Anything containing one of these substrings in its
 * User-Agent gets skipped. Covers search crawlers, AI training crawlers, SEO
 * tools, social preview scrapers, uptime monitors, and the usual HTTP client
 * default UAs.
 *
 * Matching is case-insensitive against lowercased UA. Keep this list tight —
 * false positives will silently drop real traffic.
 *
 * Last expansion: 2026-05-05. Admin saw `/tx/[hash]` doing 1218 views from
 * 1218 unique IPs in 12h (perfect 1:1 ratio = pure distributed scrape).
 * Added the AI-training crawler set + Apple/Amazon/Yandex variants —
 * transaction explorers are catnip for LLM training data ingestion.
 */
const BOT_UA_PATTERNS = [
  // Search engines
  "googlebot", "bingbot", "yandexbot", "yandeximages", "duckduckbot",
  "baiduspider", "sogou", "exabot", "facebot", "ia_archiver", "applebot",
  "amazonbot", "yeti", "mojeekbot", "seekportbot", "qwantbot", "petalbot",
  "kagibot", "youbot",
  // AI training / LLM crawlers (the biggest miss as of May 2026)
  "gptbot", "chatgpt-user", "oai-searchbot", "openai",
  "claudebot", "claude-web", "anthropic-ai",
  "perplexitybot", "perplexity-user",
  "bytespider", "ccbot", "common crawl", "cohere-ai", "diffbot",
  "imagesiftbot", "img2dataset", "omgili", "semanticscholarbot",
  "ai2bot", "magpie-crawler", "meta-externalagent", "meta-externalfetcher",
  // Social preview scrapers
  "facebookexternalhit", "twitterbot", "linkedinbot", "pinterest",
  "slackbot", "whatsapp", "discordbot", "telegrambot", "skypeuripreview",
  // SEO / scraping tools
  "ahrefsbot", "ahrefsauditbot", "semrushbot", "mj12bot", "dotbot",
  "screaming frog", "sitebulb", "seranking", "rogerbot", "barkrowler",
  "serpstatbot", "linkpadbot", "blexbot",
  // Generic patterns
  "bot/", "crawler", "spider", "scrapy", "headlesschrome", "phantomjs",
  "puppeteer", "playwright",
  // Monitoring / uptime
  "pingdom", "uptimerobot", "statuscake", "newrelicsynthetic",
  "datadogsynthetic", "site24x7", "betteruptime", "checkly",
  // Default HTTP clients
  "python-requests", "python-urllib", "aiohttp", "httpx",
  "curl/", "wget/", "go-http-client", "java/", "okhttp",
  "node-fetch", "axios", "got/", "ruby", "libwww-perl",
];

function isBot(ua: string | null): boolean {
  if (!ua) return true; // No UA header → likely platform health check or direct bot
  const lowered = ua.toLowerCase();
  return BOT_UA_PATTERNS.some((p) => lowered.includes(p));
}

/**
 * Next.js sends these headers on prefetch requests (Link hover, viewport
 * prefetch, router.prefetch). Those don't represent an actual page view —
 * the user may never click through. Skip them so analytics reflect
 * intended navigation, not speculative preloading.
 */
function isPrefetch(hdrs: Headers): boolean {
  return (
    hdrs.get("next-router-prefetch") === "1" ||
    hdrs.get("purpose") === "prefetch" ||
    hdrs.get("x-purpose") === "prefetch" ||
    hdrs.get("x-moz") === "prefetch" ||
    hdrs.get("sec-purpose")?.includes("prefetch") === true
  );
}

/**
 * Record a page view. Fire-and-forget — errors are silently ignored.
 * Called from the (app) layout on each server render.
 *
 * Skips:
 * - Bot / scraper / uptime-monitor user agents
 * - Next.js prefetch requests (Link hover, viewport prefetch)
 * - Requests with no User-Agent header (platform health checks)
 * These skips cut ~90% of the noise that was inflating view counts by
 * 10-50× on popular routes like /tx/[hash].
 */
export async function trackPageView(pathname: string) {
  try {
    const hdrs = await headers();

    if (isPrefetch(hdrs)) return;
    const ua = hdrs.get("user-agent");
    if (isBot(ua)) return;

    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? hdrs.get("x-real-ip")
      ?? "unknown";

    const visitorHash = hashVisitor(ip);
    const routePattern = toRoutePattern(pathname);
    const referrerHost = parseReferrerHost(hdrs.get("referer"));

    // Non-blocking insert — don't await in the caller
    db.insert(pageViews).values({
      route: pathname.slice(0, 200),
      routePattern: routePattern.slice(0, 100),
      visitorHash,
      referrerHost,
    }).execute().catch(() => {});
  } catch {
    // Silently ignore — analytics should never break the site
  }
}
