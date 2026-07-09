import { createOG } from "@/lib/og";

export const alt = "Sonde — Token";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ currency: string; issuer: string }>;
}) {
  const { currency } = await params;
  const decoded = decodeURIComponent(currency);
  // Hex currency codes are 40 chars — truncate so they look tidy.
  const isHex = /^[0-9A-Fa-f]{40}$/.test(decoded);
  const display = isHex ? `${decoded.slice(0, 6)}…${decoded.slice(-4)}` : decoded;

  return createOG({
      title: display,
      label: "Token",
      subtitle: "Issued token on the XRPL — holders, price, trustlines",
      mono: isHex,
    });
}
