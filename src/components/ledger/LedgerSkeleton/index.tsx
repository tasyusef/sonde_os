import Skeleton from "@/components/shared/Skeleton";
import StageRail from "@/components/shared/StageRail";

/** Placeholder for the ledger page while the expanded ledger loads,
 *  in the page's own stage, rail and list. */
export default function LedgerSkeleton() {
  return (
    <div role="status" aria-label="Loading ledger">
      <StageRail
        stage={
          <>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-3 h-8 w-48 max-w-full" />
            <Skeleton className="mt-2 h-4 w-[500px] max-w-full" />
            <Skeleton className="mt-10 h-4 w-28" />
            <Skeleton className="mt-2 h-14 w-24" />
          </>
        }
        rail={
          <div>
            <Skeleton className="mb-3 h-4 w-16" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="my-2 h-6 w-full" />
            ))}
          </div>
        }
      />

      <div className="mt-16">
        <Skeleton className="mb-3 h-4 w-28" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-b border-line py-2.5 last:border-b-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-[70px] rounded-tag" />
                <Skeleton className="h-[13px] w-[200px]" />
              </div>
              <Skeleton className="h-[13px] w-[80px]" />
            </div>
            <div className="mt-1 flex items-center justify-between">
              <Skeleton className="h-[11px] w-[200px]" />
              <Skeleton className="h-[18px] w-[18px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
