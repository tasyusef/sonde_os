import { createOG } from "@/lib/og";

export const alt = "Sonde — NFT";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const truncated = `${id.slice(0, 8)}...${id.slice(-6)}`;

  return createOG({
      title: truncated,
      label: "NFT",
      subtitle: "XRPL NFT — taxon, issuer, transfer history",
      mono: true,
    });
}
