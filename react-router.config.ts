import type { Config } from "@react-router/dev/config";
import { allDocSlugs } from "./src/routes/docs/nav";

export default {
  appDirectory: "src",
  // Static SPA: no runtime server. Paths that aren't prerendered get the
  // root-only shell (index.html), and the client router takes over.
  ssr: false,
  // Static content only. Not "/": Cloudflare serves index.html for every
  // unknown path, so it has to stay the bare shell.
  prerender: () => [
    "/support",
    "/network",
    "/watchlist",
    "/docs",
    ...allDocSlugs.map((slug) => `/docs/${slug}`),
  ],
} satisfies Config;
