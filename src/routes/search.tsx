import type { Route } from "./+types/search";
import { pageMeta } from "@/lib/meta";
import RouteError from "@/components/shared/RouteError";
import SearchResolveView from "@/components/search/SearchResolveView";

export const meta: Route.MetaFunction = () => pageMeta({ title: "Search — XRPL", robots: "noindex" });

export default function SearchPage({ params }: Route.ComponentProps) {
  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        {/* Keyed so a new search starts from fresh state. */}
        <SearchResolveView key={params.query} query={params.query} />
      </main>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} fallback="Search failed" />;
}
