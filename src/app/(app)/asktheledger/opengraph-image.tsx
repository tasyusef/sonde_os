import { createOG } from "@/lib/og";

export const alt = "Sonde — Ask the Ledger";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
      title: "Ask the Ledger",
      label: "Pro",
      subtitle: "Natural-language queries over the XRP Ledger. Ask anything in plain English — get charts, tables, and answers.",
    });
}
