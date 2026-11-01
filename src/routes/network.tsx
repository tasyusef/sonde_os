import type { Route } from "./+types/network";
import { OG_IMAGES, pageMeta } from "@/lib/meta";
import ErrorPage from "@/components/shared/ErrorPage";
import PageHero from "@/components/shared/PageHero";
import NetworkTabs from "@/components/network/NetworkTabs";

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Network Stats — XRP Ledger Live Monitoring",
    description:
      "Watch the XRP Ledger live: XRP price, ledger stats, server health, the live ledger feed, recent transactions and amendment status.",
    canonical: "/network",
    ogImage: OG_IMAGES.network,
  });

export default function NetworkPage() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHero title="Network" />
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-container flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8"
      >
        <NetworkTabs />
      </main>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <ErrorPage
      title="The network page couldn't load"
      message="Most likely a passing hiccup on a public XRPL node or the live feed."
    />
  );
}
