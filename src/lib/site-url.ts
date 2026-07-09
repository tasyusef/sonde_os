/**
 * Resolve the site's absolute base URL for metadata, sitemap, robots, and
 * anywhere else that needs a fully-qualified link.
 *
 * Order of precedence:
 *   1. NEXT_PUBLIC_SITE_URL — set this explicitly on any host (Railway, etc.).
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel's canonical prod domain.
 *   3. VERCEL_URL — Vercel preview/branch deployments.
 *   4. https://sondelab.com — production fallback so prod HTML is never broken
 *      even if env vars are missing.
 *
 * Previously this fell back to http://localhost:3000 in metadataBase, which
 * meant production OG/Twitter tags and canonical URLs pointed at localhost.
 */
export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://sondelab.com";
}
