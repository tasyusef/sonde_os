import type { Metadata } from "next";
import nextDynamic from "next/dynamic";
import FeatureUsage from "@/components/admin/FeatureUsage";
import Marketing from "@/components/admin/Marketing";
import InfraHealth from "@/components/admin/InfraHealth";
import ErrorLog from "@/components/admin/ErrorLog";

// Recharts-heavy admin sections. The admin page is internal/noindex
// with a small audience — the bundles are still meaningful per-page,
// so code-split them so any one section can paint without the others.
const SiteAnalytics = nextDynamic(
  () => import("@/components/admin/SiteAnalytics"),
);
const BusinessMetrics = nextDynamic(
  () => import("@/components/admin/BusinessMetrics"),
);
const AiUsageMetrics = nextDynamic(
  () => import("@/components/admin/AiUsageMetrics"),
);

export const metadata: Metadata = {
  title: "Admin — Sonde",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="font-display text-title font-bold text-primary">
        Admin Dashboard
      </h1>
      <p className="mt-1 font-body text-ui text-muted">
        Internal analytics and monitoring.
      </p>
      <div className="mt-8 space-y-12">
        <SiteAnalytics />
        <BusinessMetrics />
        <AiUsageMetrics />
        <FeatureUsage />
        <Marketing />
        <InfraHealth />
        <ErrorLog />
      </div>
    </main>
  );
}
