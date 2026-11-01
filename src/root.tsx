import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import ErrorPage from "@/components/shared/ErrorPage";
import { GROUND } from "@/lib/brand-colors";
import { MotionProvider } from "@/lib/motion-client";
import { SHARE_DESCRIPTION, OG_IMAGES, absoluteUrl, pageMeta } from "@/lib/meta";
import { getSiteUrl } from "@/lib/site-url";
import { CF_BEACON_SRC, CF_BEACON_TOKEN } from "@/lib/web-analytics";
import "./globals.css";
import departureMono from "./fonts/DepartureMono-Regular.woff2?url";

// Runs before first paint so a saved light theme or collapsed sidebar
// never flashes the default.
const PREFS_SCRIPT = `(function(){try{var c=document.documentElement.classList;if(localStorage.getItem('sonde-theme')==='light')c.add('light');if(localStorage.getItem('sonde-sidebar')==='rail')c.add('sidebar-rail');}catch(e){}})()`;

// Faces every page renders above the fold, fetched before the CSS is parsed.
// PARC Pixel is inlined into the CSS, so only Departure Mono needs it.
const PRELOAD_FONTS = [departureMono];

export const links: Route.LinksFunction = () => [
  ...PRELOAD_FONTS.map((href) => ({
    rel: "preload",
    href,
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous" as const,
  })),
  { rel: "manifest", href: "/manifest.webmanifest" },
  // Drawn per size by `pnpm brand`: a bitmap only stays sharp where its
  // cells land on whole pixels, which one scaled SVG can't promise.
  { rel: "icon", href: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
  { rel: "apple-touch-icon", href: "/apple-icon.png", type: "image/png", sizes: "180x180" },
];

// Site defaults: the SPA shell and any route without its own `meta` use these.
export const meta: Route.MetaFunction = () => pageMeta();

function jsonLd() {
  const siteUrl = getSiteUrl();
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Sonde",
      url: siteUrl,
      logo: absoluteUrl(OG_IMAGES.home.path),
      description: SHARE_DESCRIPTION,
      sameAs: ["https://x.com/sonde_xrpl"],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Sonde",
      url: siteUrl,
    },
  ];
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // The inline prefs script adds `light` and `sidebar-rail` before hydration, so the class
    // legitimately differs from the prerendered HTML.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Tints the mobile browser chrome to match the page background. */}
        <meta name="theme-color" content={GROUND.dark} media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content={GROUND.light} media="(prefers-color-scheme: light)" />
        <meta name="color-scheme" content="dark light" />
        <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
        <Meta />
        <Links />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()) }}
        />
      </head>
      <body className="antialiased">
        <MotionProvider>{children}</MotionProvider>
        <ScrollRestoration />
        <Scripts />
        {CF_BEACON_TOKEN && (
          <script
            defer
            src={CF_BEACON_SRC}
            data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
          />
        )}
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

// The SPA shell renders this until the client router takes over. Without it
// React Router injects its own fallback, which logs a hint to the console.
export function HydrateFallback() {
  return null;
}

// App-level error page for anything a route doesn't catch itself. It
// renders outside the app shell, so it needs none of its providers.
export function ErrorBoundary() {
  return (
    <ErrorPage
      title="Something went wrong"
      message="Sonde hit an unexpected error. Trying again usually fixes it."
    />
  );
}
