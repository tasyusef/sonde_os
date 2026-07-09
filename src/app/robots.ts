import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Block pure training crawlers — bots that ingest pages into LLM
 * training corpora and have NO live search/answer surface.
 *
 * Deliberately ALLOWED (so Sonde stays discoverable in AI search):
 *   - OAI-SearchBot, ChatGPT-User       — ChatGPT search + URL-fetch
 *   - PerplexityBot, Perplexity-User    — Perplexity search
 *   - YouBot                            — You.com search
 *   - Meta-ExternalFetcher              — Open Graph previews on
 *                                          FB / IG / Threads
 *   - Google-Extended, Applebot-Extended— Gemini + Apple Intelligence
 *                                          training (opt-in helps
 *                                          Sonde appear in AI answers)
 *   - Amazonbot                         — Alexa / Amazon search
 *
 * Standard search-engine crawlers (Googlebot, Bingbot, etc.) stay
 * under the wildcard allow rule — full discovery indexing is wanted.
 *
 * Well-behaved actors (OpenAI's GPTBot, Anthropic's ClaudeBot) honor
 * robots.txt. Bad actors (Bytespider, CCBot) ignore it; those are
 * caught by the app-level UA filter and the Cloudflare WAF rule.
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

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/designsystem"],
      },
      // Explicit deny for AI training crawlers. Each agent gets its
      // own block so the published robots.txt has a clean per-bot
      // entry that's easy to audit + extend.
      ...AI_TRAINING_BOTS.map((userAgent) => ({
        userAgent,
        disallow: "/",
      })),
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
