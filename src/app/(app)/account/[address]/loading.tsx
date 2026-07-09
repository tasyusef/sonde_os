import Skeleton from "@/components/shared/Skeleton";
import { HeroBackground } from "@/components/shared/PageHero";

export default function AccountLoading() {
  return (
    <div className="min-h-screen" role="status" aria-label="Loading account">
      {/* Hero skeleton */}
      <div className="relative overflow-hidden md:-ml-18">
        <HeroBackground />
        <div className="relative mx-auto max-w-container px-6 pt-10 pb-4 sm:pt-12 sm:pb-6 md:pl-24">
          <Skeleton className="mb-2 h-8 w-64 sm:h-10" />
          <Skeleton className="mb-4 h-4 w-72" />
          <Skeleton className="h-3.5 w-[340px] max-w-full" />
        </div>
      </div>

      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-2xl" />
          ))}
        </div>

        {/* Tabs */}
        <div className="mt-8 flex gap-6 border-b border-elevated pb-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-20" />
          ))}
        </div>

        {/* Table */}
        <div className="mt-6">
          <Skeleton className="h-[400px] rounded-2xl" />
        </div>
      </main>
    </div>
  );
}
