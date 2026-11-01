import type { MetaDescriptor } from "react-router";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Route `meta` builder. React Router's `<Meta/>` renders only the leaf
 * route's array, so every page returns the full set (title, description,
 * canonical, Open Graph, Twitter) from here rather than merging with the
 * root's.
 */

export const SITE_TITLE = "Sonde — XRPL Explorer";
export const SITE_DESCRIPTION =
  "Look up any XRP Ledger account, transaction, ledger or NFT, laid out so it's easy to read. Free, with a live ledger feed.";
/** The shorter line used on share cards. */
export const SHARE_DESCRIPTION = "A free, easy-to-read explorer for the XRP Ledger.";

export interface OgImage {
  /** Root-relative path to a 1200×630 PNG in `public/`. */
  path: string;
  alt: string;
}

export const OG_IMAGES = {
  home: { path: "/og/home.png", alt: "Sonde — XRPL Explorer" },
  support: { path: "/og/support.png", alt: "Sonde — Support" },
  network: { path: "/og/network.png", alt: "Sonde — Network" },
  docs: { path: "/og/docs.png", alt: "Sonde — Docs" },
} satisfies Record<string, OgImage>;

export interface PageMeta {
  /** Shown as "<title> | Sonde". Omit both titles for the site default. */
  title?: string;
  /** Shown as-is, without the " | Sonde" suffix. */
  absoluteTitle?: string;
  description?: string;
  /** Root-relative path for `rel=canonical`. "/" becomes the bare origin. */
  canonical?: string;
  robots?: "noindex" | "noindex, nofollow";
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: OgImage;
}

export function absoluteUrl(path: string): string {
  const siteUrl = getSiteUrl();
  return path === "/" ? siteUrl : `${siteUrl}${path}`;
}

export function pageMeta(page: PageMeta = {}): MetaDescriptor[] {
  const image = page.ogImage ?? OG_IMAGES.home;
  const title = page.absoluteTitle ?? (page.title ? `${page.title} | Sonde` : SITE_TITLE);

  return [
    { title },
    { name: "description", content: page.description ?? SITE_DESCRIPTION },
    ...(page.robots ? [{ name: "robots", content: page.robots }] : []),
    ...(page.canonical
      ? [{ tagName: "link", rel: "canonical", href: absoluteUrl(page.canonical) }]
      : []),
    { property: "og:title", content: page.ogTitle ?? SITE_TITLE },
    { property: "og:description", content: page.ogDescription ?? SHARE_DESCRIPTION },
    { property: "og:site_name", content: "Sonde" },
    { property: "og:locale", content: "en_US" },
    { property: "og:type", content: "website" },
    { property: "og:image", content: absoluteUrl(image.path) },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: image.alt },
    // X always gets the site-wide card.
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:site", content: "@sonde_xrpl" },
    { name: "twitter:creator", content: "@sonde_xrpl" },
    { name: "twitter:title", content: SITE_TITLE },
    { name: "twitter:description", content: SHARE_DESCRIPTION },
    { name: "twitter:image", content: absoluteUrl(OG_IMAGES.home.path) },
  ];
}
