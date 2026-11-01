import { useLocation } from "react-router";
import type { Route } from "./+types/not-found";
import { pageMeta } from "@/lib/meta";
import PageAlert from "@/components/shared/PageAlert";

export const meta: Route.MetaFunction = () =>
  pageMeta({ title: "Page not found", robots: "noindex" });

/** Catch-all for any path no other route matches. */
export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <PageAlert message="Page not found" detail={pathname} />
      </main>
    </div>
  );
}
