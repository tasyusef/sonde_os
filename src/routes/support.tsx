import type { Route } from "./+types/support";
import { OG_IMAGES, pageMeta } from "@/lib/meta";
import PageHero from "@/components/shared/PageHero";
import SupportContent from "@/components/support/SupportContent";

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Support",
    description:
      "Answers to common questions about Sonde, the XRPL explorer: where its data comes from, why transactions fail, and how to reach us.",
    canonical: "/support",
    robots: "noindex, nofollow",
    ogImage: OG_IMAGES.support,
  });

export default function SupportPage() {
  return (
    <main id="main-content">
      <PageHero title="Support" />
      <div className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <SupportContent />
      </div>
    </main>
  );
}
