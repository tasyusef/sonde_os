import Skeleton from "@/components/shared/Skeleton";

function CardSkeleton({
  className,
  lines = 3,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div
      className={`rounded-2xl shadow-card bg-surface ${className ?? ""}`}
    >
      <div className="border-b border-elevated px-4 py-2.5">
        <Skeleton className="h-[10px] w-[100px]" />
      </div>
      <div className="space-y-3 px-4 py-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-[13px] w-full" />
        ))}
      </div>
    </div>
  );
}

export default function NetworkLoading() {
  return (
    <div className="min-h-screen" role="status" aria-label="Loading network">
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        {/* Title */}
        <div className="mb-6">
          <Skeleton className="mb-2 h-[24px] w-[120px]" />
          <Skeleton className="h-[13px] w-[320px] max-w-full" />
        </div>

        {/* Health Banner */}
        <div className="mb-6 rounded-2xl shadow-card bg-surface">
          <div className="border-b border-elevated px-4 py-2.5">
            <Skeleton className="h-[10px] w-[120px]" />
          </div>
          <div className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="mb-1 h-[9px] w-[70px]" />
                <Skeleton className="h-[13px] w-[100px]" />
              </div>
            ))}
          </div>
        </div>

        {/* Stats + Chart */}
        <div className="mb-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} lines={3} />
            ))}
          </div>
          <div className="rounded-2xl shadow-card bg-surface p-4">
            <Skeleton className="h-[250px] w-full rounded-lg" />
          </div>
        </div>

        {/* Fee + Tx Distribution */}
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <CardSkeleton lines={6} />
          <CardSkeleton lines={6} />
        </div>

        {/* Performance + Live Feed */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <CardSkeleton lines={8} />
          <CardSkeleton lines={8} />
        </div>
      </main>
    </div>
  );
}
