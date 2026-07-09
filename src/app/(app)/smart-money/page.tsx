import type { Metadata } from "next";
import SmartMoneyPage from "@/components/smart-money/SmartMoneyPage";

export const metadata: Metadata = {
  title: "Smart Money",
  description:
    "Discover XRPL wallets with proven trading edge. Composite scoring based on PnL, win rate, consistency, early buying, and smart exits.",
  alternates: { canonical: "/smart-money" },
};

// SmartMoneyPage uses useTabSlug which calls useSearchParams() to
// hydrate the active tab from `?tab=`. Next 16 refuses to statically
// prerender pages that read URL query params without a Suspense
// boundary — opting out of prerender is the honest call here since
// the URL params drive the rendered tab anyway.
export const dynamic = "force-dynamic";

export default function Page() {
  return <SmartMoneyPage />;
}
