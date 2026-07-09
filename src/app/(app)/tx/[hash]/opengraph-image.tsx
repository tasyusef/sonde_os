import { createOG } from "@/lib/og";

export const alt = "Sonde — Transaction";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;
  const truncated = `${hash.slice(0, 8)}...${hash.slice(-6)}`;

  return createOG({
      title: truncated,
      label: "Transaction",
      subtitle: "XRPL transaction — sender, receiver, amount, outcome",
      mono: true,
    });
}
