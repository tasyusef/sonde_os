import { describe, expect, it } from "vitest";
import { allDocSlugs } from "@/routes/docs/nav";
import { GROUND } from "./brand-colors";
import { XRPL_NODES } from "./xrpl-socket";
import {
  contentSecurityPolicy,
  headersFile,
  robotsTxt,
  siteFiles,
  sitemapXml,
  webManifest,
} from "./site-files";

const SITE = "https://example.test";

describe("robotsTxt", () => {
  it("allows everything but /designsystem for regular crawlers", () => {
    expect(robotsTxt(SITE).startsWith("User-Agent: *\nAllow: /\nDisallow: /designsystem\n\n")).toBe(
      true,
    );
  });

  it("gives each training bot its own block and ends with the sitemap", () => {
    const txt = robotsTxt(SITE);
    expect(txt).toContain("\n\nUser-Agent: GPTBot\nDisallow: /\n\n");
    expect(txt).toContain("\n\nUser-Agent: Meta-ExternalAgent\nDisallow: /\n\n");
    expect(txt.endsWith(`\n\nSitemap: ${SITE}/sitemap.xml\n`)).toBe(true);
  });
});

describe("sitemapXml", () => {
  const xml = sitemapXml(SITE);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it("lists the public pages and every doc, with the bare origin for /", () => {
    expect(locs).toEqual([
      SITE,
      `${SITE}/network`,
      `${SITE}/support`,
      `${SITE}/docs`,
      ...allDocSlugs.map((slug) => `${SITE}/docs/${slug}`),
    ]);
  });

  it("is a well-formed urlset", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
    expect(xml.endsWith("</urlset>\n")).toBe(true);
    expect(xml.match(/<url>/g)).toHaveLength(locs.length);
    expect(xml.match(/<\/url>/g)).toHaveLength(locs.length);
  });
});

describe("webManifest", () => {
  it("is valid JSON with both PWA icons, plain and maskable", () => {
    const manifest = JSON.parse(webManifest());
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.map((i: { src: string; purpose: string }) => `${i.src} ${i.purpose}`)).toEqual([
      "/icon-192.png any",
      "/icon-512.png any",
      "/icon-192.png maskable",
      "/icon-512.png maskable",
    ]);
  });

  it("paints the splash and title bar in the dark page", () => {
    const manifest = JSON.parse(webManifest());
    expect([manifest.background_color, manifest.theme_color]).toEqual([GROUND.dark, GROUND.dark]);
  });
});

describe("contentSecurityPolicy", () => {
  const connectSrc = (csp: string) =>
    csp.split("; ").find((d) => d.startsWith("connect-src "))?.split(" ") ?? [];

  it("allows every XRPL node the socket can fail over to", () => {
    const sources = connectSrc(contentSecurityPolicy());
    for (const node of XRPL_NODES) expect(sources).toContain(node);
  });

  it("adds the relay origin only when one is configured", () => {
    expect(connectSrc(contentSecurityPolicy({ relayUrl: "wss://relay.example.test/live" }))).toContain(
      "wss://relay.example.test",
    );
    expect(contentSecurityPolicy()).not.toContain("relay");
  });

  it("allows the analytics script only when analytics is on", () => {
    const scriptSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("script-src ")) ?? "";
    expect(scriptSrc(contentSecurityPolicy({ webAnalytics: true }))).toContain(
      "https://static.cloudflareinsights.com",
    );
    expect(contentSecurityPolicy()).not.toContain("cloudflareinsights");
    // The beacon reports to cloudflareinsights.com, which `https:` covers.
    expect(connectSrc(contentSecurityPolicy({ webAnalytics: true }))).toContain("https:");
  });

  it("allows the data: fonts PARC Pixel is inlined as, and no font hosts", () => {
    expect(contentSecurityPolicy()).toContain("font-src 'self' data:;");
  });

  it("loads no third-party scripts or frames", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("script-src 'self' 'unsafe-inline';");
    expect(csp).toContain("frame-src 'self';");
    expect(csp).not.toContain("tradingview");
  });
});

describe("headersFile", () => {
  it("puts the security headers on every path and caches hashed assets", () => {
    const lines = headersFile({ relayUrl: "ws://127.0.0.1:8788/live" }).split("\n");
    expect(lines[0]).toBe("/*");
    expect(lines).toContain("  X-Frame-Options: SAMEORIGIN");
    expect(lines.find((l) => l.startsWith("  Content-Security-Policy: "))).toContain(
      "connect-src 'self' ws://127.0.0.1:8788 https:",
    );
    expect(lines).toContain("/assets/*");
    expect(lines).toContain("  Cache-Control: public, max-age=31536000, immutable");
  });
});

describe("siteFiles", () => {
  it("emits every file with the site URL filled in", () => {
    const files = siteFiles({ VITE_SITE_URL: SITE });
    expect(Object.keys(files).sort()).toEqual(
      ["_headers", "_redirects", "llms.txt", "manifest.webmanifest", "robots.txt", "sitemap.xml"].sort(),
    );
    expect(files["llms.txt"]).toContain(`The product is hosted at ${SITE}.`);
    expect(files._redirects).toBe("/home / 301\n");
  });

  it("falls back to the production origin and drops an empty relay URL", () => {
    const files = siteFiles({ VITE_SITE_URL: "", VITE_LIVE_RELAY_URL: "" });
    expect(files["robots.txt"]).toContain("Sitemap: https://sondelab.com/sitemap.xml");
    expect(files._headers).toContain("connect-src 'self' https:");
  });

  it("allows the analytics script only when a beacon token is set", () => {
    expect(siteFiles({ VITE_CF_BEACON_TOKEN: "test-token" })._headers).toContain(
      "https://static.cloudflareinsights.com",
    );
    expect(siteFiles({ VITE_CF_BEACON_TOKEN: "" })._headers).not.toContain("cloudflareinsights");
  });
});
