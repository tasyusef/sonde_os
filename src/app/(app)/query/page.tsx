import { permanentRedirect } from "next/navigation";

/**
 * /query is permanently moved to /asktheledger as of 2026-05-03.
 * Kept as a 308 redirect to preserve any external bookmarks.
 *
 * Eventually safe to remove the route entirely once external traffic
 * to /query has dropped to zero (check Cloudflare Analytics in a few
 * months and decide).
 */
export default function QueryRedirectPage(): never {
  permanentRedirect("/asktheledger");
}
