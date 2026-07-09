import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sonde — Real-time XRPL Analytics",
    short_name: "Sonde",
    description:
      "Real-time intelligence, analytics, and portfolio tracking for the XRP Ledger.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0D10",
    theme_color: "#E8856C",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
