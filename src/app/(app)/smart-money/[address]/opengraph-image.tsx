import { createOG } from "@/lib/og";

export const alt = "Sonde — Smart Money Wallet";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  const truncated = `${address.slice(0, 8)}...${address.slice(-6)}`;

  return createOG({
      title: truncated,
      label: "Smart Money",
      subtitle: "XRPL trader profile — realized PnL, holdings, tokens, and activity",
      mono: true,
    });
}
