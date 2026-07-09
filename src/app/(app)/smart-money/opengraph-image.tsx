import { createOG } from "@/lib/og";

export const alt = "Sonde — Smart Money";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
      title: "Smart Money",
      label: "Leaderboard",
      subtitle: "The most profitable wallets on the XRP Ledger, ranked by realized PnL and consistency",
    });
}
