import { createOG } from "@/lib/og";

export const alt = "Sonde — Ledger";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ index: string }>;
}) {
  const { index } = await params;
  const formatted = Number(index).toLocaleString("en-US");

  return createOG({
      title: `#${formatted}`,
      label: "Ledger",
      subtitle: "XRPL ledger — transactions, validators, close time",
      mono: true,
    });
}
