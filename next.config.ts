import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    // Allow any HTTPS host for direct external images (token icons from
    // arbitrary XLS-26 TOML URLs, marketplace logos, collection covers).
    // The CSP `img-src` already restricts what the browser will load.
    // NFT images go through `/api/nft-image?url=...` and are rendered
    // with `unoptimized` since localPatterns.search doesn't support
    // wildcards — the proxy already does 30-day immutable caching.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    // 30-day cache for the optimizer's filesystem cache.
    minimumCacheTTL: 60 * 60 * 24 * 30,
    formats: ["image/avif", "image/webp"],
  },
  async redirects() {
    return [
      // /home briefly existed as the landing route — kept this redirect
      // so any cached or bookmarked /home URLs still resolve. Can be
      // removed after a few months of stable analytics showing no
      // traffic to /home.
      {
        source: "/home",
        destination: "/",
        permanent: true,
      },
      {
        source: "/dex",
        destination: "/markets",
        permanent: true,
      },
      {
        source: "/tokens",
        destination: "/markets",
        permanent: true,
      },
      {
        source: "/tokens/:path*",
        destination: "/markets/:path*",
        permanent: true,
      },
      {
        source: "/dashboard",
        destination: "/portfolio",
        permanent: true,
      },
      {
        source: "/intelligence",
        destination: "/research",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://*.tradingview.com`,
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "img-src 'self' data: https: blob:",
              "connect-src 'self' https://min-api.cryptocompare.com https://api.anthropic.com https://generativelanguage.googleapis.com https://api.openai.com wss://honeycluster.io wss://s1.ripple.com wss://s2.ripple.com wss://xrplcluster.com wss://relay.walletconnect.org wss://relay.walletconnect.com https://relay.walletconnect.org https://relay.walletconnect.com https://rpc.walletconnect.org https://rpc.walletconnect.com https://pulse.walletconnect.org https://pulse.walletconnect.com https://keys.walletconnect.org https://keys.walletconnect.com https://echo.walletconnect.org https://echo.walletconnect.com",
              "frame-src 'self' https://*.tradingview.com https://*.tradingview-widget.com https://verify.walletconnect.org https://verify.walletconnect.com https://secure.walletconnect.org https://secure.walletconnect.com",
              "child-src 'self' https://*.tradingview.com https://*.tradingview-widget.com",
              "frame-ancestors 'self' https://timothyali.com https://*.timothyali.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
