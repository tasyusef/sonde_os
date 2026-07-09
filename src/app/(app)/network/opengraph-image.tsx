import { createOG } from "@/lib/og";

export const alt = "Sonde — Network";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
      title: "Network",
      label: "Network",
      subtitle: "Live XRP Ledger analytics — transaction volume, active accounts, validators, amendments",
    });
}
