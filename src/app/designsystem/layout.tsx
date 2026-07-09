import type { Metadata } from "next";
import SkipLink from "@/components/shared/SkipLink";

export const metadata: Metadata = {
  title: "Design System",
  robots: { index: false, follow: false },
};

export default function DesignSystemLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <SkipLink />
      {children}
    </>
  );
}
