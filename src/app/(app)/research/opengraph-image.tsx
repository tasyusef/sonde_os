import { createOG } from "@/lib/og";

export const alt = "Sonde — Research";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return createOG({
      title: "Research",
      label: "Research",
      subtitle: "AI-powered XRPL investigation — fund tracing, graph analysis, natural-language queries",
    });
}
