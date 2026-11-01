import type { Route } from "./+types/watchlist";
import { pageMeta } from "@/lib/meta";
import PageHero from "@/components/shared/PageHero";
import WatchlistTab from "@/components/intel/IntelligenceDashboard/WatchlistTab";

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Watchlist",
    description: "XRPL accounts you've saved in this browser.",
    canonical: "/watchlist",
    robots: "noindex, nofollow",
  });

export default function WatchlistPage() {
  return (
    <main id="main-content">
      <PageHero title="Watchlist" />
      <div className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <div className="max-w-2xl">
          <WatchlistTab />
        </div>
      </div>
    </main>
  );
}
