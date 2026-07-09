import { createOG } from "@/lib/og";

export const alt = "Sonde — Portfolio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
      title: "Portfolio",
      label: "Portfolio",
      subtitle: "Balances, PnL, transaction history, and alerts — scoped to your XRPL wallet",
    });
}
