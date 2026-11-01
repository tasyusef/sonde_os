import type { Route } from "./+types/home";
import { pageMeta } from "@/lib/meta";
import Hero from "@/components/home/Hero";

// Site-default title and description.
export const meta: Route.MetaFunction = () => pageMeta({ canonical: "/" });

export default function Home() {
  return (
    <main id="main-content">
      <Hero />
    </main>
  );
}
