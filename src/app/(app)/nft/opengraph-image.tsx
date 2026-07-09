import { createOG } from "@/lib/og";

export const alt = "Sonde — NFTs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
      title: "NFTs",
      label: "NFTs",
      subtitle: "Browse XRPL NFTs by collection, issuer, and taxon",
    });
}
