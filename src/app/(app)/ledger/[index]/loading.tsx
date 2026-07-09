import Skeleton from "@/components/shared/Skeleton";

export default function LedgerLoading() {
  return (
    <div className="min-h-screen" role="status" aria-label="Loading ledger">
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        {/* Title + hash */}
        <Skeleton className="mb-2 h-[28px] w-[240px] max-w-full" />
        <Skeleton className="mb-6 h-[14px] w-[500px] max-w-full" />

        {/* 4 stat cards with header + content structure */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl shadow-card bg-surface">
              <div className="border-b border-elevated px-4 py-2.5">
                <Skeleton className="h-[10px] w-[80px]" />
              </div>
              <div className="px-4 py-3">
                <Skeleton className="h-[14px] w-full" />
              </div>
            </div>
          ))}
        </div>

        {/* Transaction rows */}
        <div className="mt-8">
          <Skeleton className="mb-4 h-[12px] w-[160px]" />
          <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-elevated px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-[20px] w-[70px] rounded-tag" />
                    <Skeleton className="h-[13px] w-[200px]" />
                  </div>
                  <Skeleton className="h-[13px] w-[80px]" />
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-[11px] w-[100px]" />
                    <Skeleton className="h-[11px] w-[100px]" />
                  </div>
                  <Skeleton className="h-[18px] w-[18px] rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
