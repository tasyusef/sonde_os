import { createOG } from "@/lib/og";

export const alt = "Sonde — About";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
      title: "About",
      label: "About",
      subtitle: "The team, mission, and technology behind Sonde",
    });
}
