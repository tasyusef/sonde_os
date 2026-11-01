import Skeleton from "@/components/shared/Skeleton";

/** Placeholder for the NFT page while `nft_info` loads, in the page's
 *  own shape: the stage, the rail beside it, the history below. */
export default function NFTSkeleton() {
  return (
    <div className="min-h-screen" role="status" aria-label="Loading NFT details">
      <main id="main-content" className="mx-auto max-w-container px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_var(--spacing-rail)]">
          <Skeleton className="aspect-square w-full lg:max-h-[calc(100dvh-10rem)]" />
          <div className="flex flex-col gap-10">
            <div className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
            <div className="space-y-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-4" />
              ))}
            </div>
          </div>
        </div>
        <Skeleton className="mt-16 h-72" />
      </main>
    </div>
  );
}
