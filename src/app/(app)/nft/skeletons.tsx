import Skeleton from "@/components/shared/Skeleton";

export function DiscoverySkeleton() {
  return (
    <div className="mb-6 grid gap-6 sm:grid-cols-2" role="status" aria-label="Loading discovery data">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-2xl shadow-card bg-surface">
          <div className="border-b border-elevated px-4 py-2.5">
            <Skeleton className="h-[10px] w-[120px]" />
          </div>
          <div className="space-y-3 px-4 py-3">
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="flex items-center gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <Skeleton className="h-[12px] w-full max-w-[140px]" />
                <Skeleton className="ml-auto h-[12px] w-[80px]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MintsSkeleton() {
  return (
    <div className="mb-6 rounded-2xl shadow-card bg-surface" role="status" aria-label="Loading recent mints">
      <div className="border-b border-elevated px-4 py-2.5">
        <Skeleton className="h-[10px] w-[100px]" />
      </div>
      <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
