import type { Metadata, Viewport } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

const satoshi = localFont({
  src: [
    { path: "../fonts/Satoshi-Light.woff2", weight: "300", style: "normal" },
    { path: "../fonts/Satoshi-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Satoshi-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/Satoshi-Bold.woff2", weight: "700", style: "normal" },
    { path: "../fonts/Satoshi-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-body",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-mono",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Theme-color drives the iOS/Android browser-chrome tint. Salmon
  // brand on light, dark slate on dark — matches the actual page bg
  // so the address bar reads as a continuation of the content.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0F1117" },
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
  ],
  colorScheme: "dark light",
};

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "Sonde — Real-time XRPL Analytics",
    template: "%s | Sonde",
  },
  description:
    "Real-time intelligence, analytics, and portfolio tracking for the XRP Ledger. Live ledger feed, smart-money rankings, AMM volume, anomaly detection — accurate by default.",
  openGraph: {
    type: "website",
    siteName: "Sonde",
    locale: "en_US",
    title: "Sonde — Real-time XRPL Analytics",
    description:
      "Real-time intelligence, analytics, and portfolio tracking for the XRP Ledger.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@sondexrpl",
    creator: "@sondexrpl",
    title: "Sonde — Real-time XRPL Analytics",
    description:
      "Real-time intelligence, analytics, and portfolio tracking for the XRP Ledger.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const siteUrl = getSiteUrl();

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Sonde",
      url: siteUrl,
      logo: `${siteUrl}/opengraph-image`,
      description:
        "Real-time intelligence, analytics, and portfolio tracking for the XRP Ledger.",
      sameAs: ["https://x.com/sonde_xrpl"],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Sonde",
      url: siteUrl,
      // Sitelinks search action — the home page no longer hosts a
      // `?q=…` search form, so point this at /asktheledger which DOES
      // auto-submit when landed with a `q` query param (see its
      // PageClient `Auto-submit if landed with ?q=…` hook).
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${siteUrl}/asktheledger?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ];

  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('sonde-theme');if(t==='light')document.documentElement.classList.add('light');}catch(e){}})()`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${satoshi.variable} ${dmSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
