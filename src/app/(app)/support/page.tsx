import type { Metadata } from "next";
import PageHero from "@/components/shared/PageHero";
import SupportContent from "@/components/support/SupportContent";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with Sonde — frequently asked questions about the XRPL explorer, contact information, XRPL node connection status, and troubleshooting for common issues.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return (
    <main>
      <PageHero
        title="Support"
        subtitle="FAQ, contact information, and network status."
      />
      <div className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <SupportContent />
      </div>
    </main>
  );
}
