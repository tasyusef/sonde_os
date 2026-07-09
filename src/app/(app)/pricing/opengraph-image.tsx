import { createOG } from "@/lib/og";

export const alt = "Sonde — Pricing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
      title: "Pricing",
      label: "Pricing",
      subtitle: "Free explorer, Pro intelligence, and bring-your-own-key AI — pay in XRP, RLUSD, or fiat",
    });
}
