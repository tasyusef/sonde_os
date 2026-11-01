/** Cloudflare Web Analytics: cookieless page views. The script reads the
 *  site token from its `data-cf-beacon` attribute and reports route
 *  changes in the SPA on its own. */
export const CF_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

/** Production builds only, so local builds and `pnpm dev` never count. */
export const CF_BEACON_TOKEN = import.meta.env.PROD
  ? import.meta.env.VITE_CF_BEACON_TOKEN || undefined
  : undefined;
