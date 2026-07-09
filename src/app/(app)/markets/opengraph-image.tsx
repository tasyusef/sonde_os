import { createOG } from "@/lib/og";

export const alt = "Sonde — Markets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
      title: "Markets",
      label: "Markets",
      subtitle: "Tokens, pairs, and DEX activity on the XRP Ledger",
    });
}
