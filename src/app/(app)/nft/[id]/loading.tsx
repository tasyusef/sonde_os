import Skeleton from "@/components/shared/Skeleton";

export default function NFTDetailLoading() {
  return (
    <div className="min-h-screen" role="status" aria-label="Loading NFT details">
      {/* Hero skeleton */}
      <div className="relative overflow-hidden">
        <div className="dashboard-gradient pointer-events-none absolute -left-4 -right-4 -top-6 bottom-0 md:-left-18 md:-right-6" />
        <div className="relative mx-auto max-w-container px-6 pt-6 pb-8 sm:pt-8 sm:pb-10">
          <Skeleton className="mb-4 h-4 w-16" />
          <Skeleton className="mb-3 h-5 w-20" />
          <Skeleton className="mb-3 h-8 w-48 sm:h-10" />
          <Skeleton className="h-4 w-[480px] max-w-full" />
        </div>
      </div>

      <main id="main-content" className="mx-auto max-w-container space-y-6 px-6 py-8">
        {/* Details bar */}
        <Skeleton className="h-[72px] rounded-2xl" />
        {/* Image + Stats */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="aspect-square rounded-2xl" />
          <Skeleton className="h-[360px] rounded-2xl" />
        </div>

        {/* Offers */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[200px] rounded-2xl" />
          <Skeleton className="h-[200px] rounded-2xl" />
        </div>

        {/* History */}
        <Skeleton className="h-[300px] rounded-2xl" />
      </main>
    </div>
  );
}
