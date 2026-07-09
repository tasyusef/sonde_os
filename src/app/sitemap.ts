import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Approximate "last meaningful update" baseline for sitemap entries.
 * Better than `new Date()` everywhere — Google deprioritizes lastMod
 * signals from sites that always report "now" because it's clearly
 * a build artifact, not real change tracking.
 *
 * Bump this when there's a meaningful content sweep across pages.
 * Per-page lastModified can be set inline below when a single route
 * has had a notable content update.
 */
const SITE_LAST_UPDATED = new Date("2026-05-05");

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getSiteUrl();
  const lm = SITE_LAST_UPDATED;

  return [
    // ── Top-level surfaces ──
    { url: baseUrl, lastModified: lm, changeFrequency: "always", priority: 1.0 },
    { url: `${baseUrl}/markets`, lastModified: lm, changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/network`, lastModified: lm, changeFrequency: "hourly", priority: 0.8 },
    { url: `${baseUrl}/nft`, lastModified: lm, changeFrequency: "hourly", priority: 0.8 },
    { url: `${baseUrl}/asktheledger`, lastModified: lm, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/smart-money`, lastModified: lm, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/portfolio`, lastModified: lm, changeFrequency: "daily", priority: 0.7 },
    // /research temporarily offline (2026-05-02) — re-add here when restored

    // ── Brand / conversion / support ──
    { url: `${baseUrl}/about`, lastModified: lm, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/pricing`, lastModified: lm, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/support`, lastModified: lm, changeFrequency: "monthly", priority: 0.5 },

    // ── Documentation ──
    { url: `${baseUrl}/docs`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/introduction`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/what-is-xrpl`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/searching`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/connecting`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/accounts`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/accounts-and-keys`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/transactions`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/transaction-types`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/tokens`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/nfts`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/portfolio-features`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/intelligence-overview`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/ai-queries`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/fund-tracing`, lastModified: lm, changeFrequency: "monthly", priority: 0.6 },
  ];
}
