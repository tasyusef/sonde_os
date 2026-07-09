import { createOG } from "@/lib/og";

export const alt = "Sonde — Support";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
      title: "Support",
      label: "Support",
      subtitle: "Get help with Sonde — documentation, FAQ, and direct contact",
    });
}
