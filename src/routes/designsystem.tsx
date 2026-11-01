import type { Route } from "./+types/designsystem";
import { pageMeta } from "@/lib/meta";
import DesignSystemPage from "@/components/designsystem/DesignSystemPage";
import SkipLink from "@/components/shared/SkipLink";

export const meta: Route.MetaFunction = () =>
  pageMeta({ title: "Design System", robots: "noindex, nofollow" });

export default function DesignSystemRoute() {
  return (
    <>
      <SkipLink />
      <DesignSystemPage />
    </>
  );
}
