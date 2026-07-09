import { headers } from "next/headers";
import { trackPageView } from "@/lib/pageview";

/**
 * Invisible server component that records a page view on each render.
 * Accepts pathname as a prop from pages (since layouts don't re-render on navigation).
 */
export default async function PageViewTracker({ pathname }: { pathname?: string }) {
  const hdrs = await headers();
  const path = pathname ?? hdrs.get("x-pathname") ?? hdrs.get("x-invoke-path") ?? "/";
  trackPageView(path);
  return null;
}
