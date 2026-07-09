import { createOG } from "@/lib/og";

export const alt = "Sonde — Real-time XRPL Analytics";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
    title: "Sonde",
    titleAsLogo: true,
    subtitle:
      "Real-time intelligence and analytics for the XRP Ledger",
  });
}
