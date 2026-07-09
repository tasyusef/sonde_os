import Skeleton from "@/components/shared/Skeleton";
import { DiscoverySkeleton, MintsSkeleton } from "./skeletons";

export default function NFTLoading() {
  return (
    <div className="min-h-screen">
      {/* Hero + search skeleton — matches PageHero layout */}
      <section>
        <div className="mx-auto max-w-container px-6 pt-10 pb-4 sm:pt-12 sm:pb-6">
          <Skeleton className="mb-2 h-[28px] w-[160px]" />
          <Skeleton className="mt-2 h-[14px] w-[300px] max-w-full" />
          <div className="mt-5 flex gap-3">
            <Skeleton className="h-[42px] w-full max-w-xl rounded-2xl" />
            <Skeleton className="h-[42px] w-[80px] shrink-0 rounded-2xl" />
          </div>
        </div>
      </section>

      {/* Content skeletons — match Suspense fallback shapes */}
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <DiscoverySkeleton />
        <MintsSkeleton />
      </main>
    </div>
  );
}
