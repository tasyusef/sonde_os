import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig, runnerImport, type Plugin } from "vite";

const alias = {
  // Mirrors tsconfig `paths`. Vite only matches "@" exactly or as an "@/" prefix, so scoped packages are unaffected.
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

const DEV_CONTENT_TYPES: Record<string, string> = {
  "/robots.txt": "text/plain; charset=utf-8",
  "/sitemap.xml": "application/xml; charset=utf-8",
  "/llms.txt": "text/plain; charset=utf-8",
  "/manifest.webmanifest": "application/manifest+json; charset=utf-8",
};

/**
 * Writes robots.txt, sitemap.xml, llms.txt, the web manifest and the
 * Cloudflare `_headers` / `_redirects` (src/lib/site-files.ts) into the
 * client build, using this mode's VITE_ env. The dev server serves the
 * first four.
 */
function siteFilesPlugin(): Plugin {
  let files: Record<string, string> = {};
  return {
    name: "sonde:site-files",
    async configResolved(config) {
      // Loaded through Vite, not imported, so src keeps its `@/` imports.
      const { module } = await runnerImport<typeof import("./src/lib/site-files")>(
        "/src/lib/site-files.ts",
        { root: config.root, configFile: false, resolve: { alias } },
      );
      files = module.siteFiles(config.env);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        const type = DEV_CONTENT_TYPES[path];
        if (!type) return next();
        res.setHeader("Content-Type", type);
        res.end(files[path.slice(1)]);
      });
    },
    generateBundle() {
      if (this.environment.name !== "client") return;
      for (const [fileName, source] of Object.entries(files)) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), siteFilesPlugin()],
  // Same port as before the port, so the relay's ALLOWED_ORIGINS and the
  // launch config still match.
  server: { port: 3000 },
  resolve: { alias },
});
