import { describe, expect, it } from "vitest";
import type { MetaDescriptor } from "react-router";
import { OG_IMAGES, SHARE_DESCRIPTION, SITE_DESCRIPTION, SITE_TITLE, pageMeta } from "./meta";
import { getSiteUrl } from "./site-url";

const SITE = getSiteUrl();

function find(meta: MetaDescriptor[], key: string, value: string) {
  return meta.find((m) => (m as Record<string, unknown>)[key] === value) as
    | Record<string, string>
    | undefined;
}

describe("pageMeta", () => {
  it("falls back to the site defaults", () => {
    const meta = pageMeta();
    expect(meta[0]).toEqual({ title: SITE_TITLE });
    expect(find(meta, "name", "description")?.content).toBe(SITE_DESCRIPTION);
    expect(find(meta, "property", "og:title")?.content).toBe(SITE_TITLE);
    expect(find(meta, "property", "og:description")?.content).toBe(SHARE_DESCRIPTION);
    expect(find(meta, "property", "og:image")?.content).toBe(`${SITE}${OG_IMAGES.home.path}`);
    expect(find(meta, "name", "robots")).toBeUndefined();
    expect(find(meta, "rel", "canonical")).toBeUndefined();
  });

  it("appends the site name unless the title is absolute", () => {
    expect(pageMeta({ title: "Support" })[0]).toEqual({ title: "Support | Sonde" });
    expect(pageMeta({ absoluteTitle: "XRPL Docs" })[0]).toEqual({ title: "XRPL Docs" });
  });

  it("builds absolute canonical links, with a bare origin for home", () => {
    expect(find(pageMeta({ canonical: "/support" }), "rel", "canonical")).toEqual({
      tagName: "link",
      rel: "canonical",
      href: `${SITE}/support`,
    });
    expect(find(pageMeta({ canonical: "/" }), "rel", "canonical")?.href).toBe(SITE);
  });

  it("uses the page's share card but keeps the site card for X", () => {
    const meta = pageMeta({ ogTitle: "Support", ogImage: OG_IMAGES.support, robots: "noindex" });
    expect(find(meta, "property", "og:title")?.content).toBe("Support");
    expect(find(meta, "property", "og:image")?.content).toBe(`${SITE}/og/support.png`);
    expect(find(meta, "property", "og:image:alt")?.content).toBe("Sonde — Support");
    expect(find(meta, "name", "twitter:title")?.content).toBe(SITE_TITLE);
    expect(find(meta, "name", "twitter:image")?.content).toBe(`${SITE}/og/home.png`);
    expect(find(meta, "name", "robots")?.content).toBe("noindex");
  });
});
