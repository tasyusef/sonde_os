/** Production origin, used whenever `VITE_SITE_URL` is unset. */
export const DEFAULT_SITE_URL = "https://sondelab.com";

/**
 * The site's absolute base URL for canonical links, OG tags, the sitemap
 * and robots.txt.
 *
 * `VITE_SITE_URL` sets it per host and is baked in at build time. Without
 * it, production URLs still point at https://sondelab.com, never localhost.
 */
export function getSiteUrl(): string {
  return import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL;
}
