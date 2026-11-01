import Skeleton from "@/components/shared/Skeleton";
import StageRail from "@/components/shared/StageRail";

/** Placeholder for the tx page while the `tx` reply loads, in the
 *  page's own shape: the stage, the rail beside it, the tables below. */
export default function TxSkeleton() {
  return (
    <div role="status" aria-label="Loading transaction">
      <StageRail
        stage={
          <div>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-8 w-48" />
            <Skeleton className="mt-3 h-4 w-full max-w-md" />
            <Skeleton className="mt-10 h-14 w-2/3" />
            <Skeleton className="mt-8 h-4 w-full max-w-sm" />
          </div>
        }
        rail={
          <div className="space-y-4">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-4" />
            ))}
          </div>
        }
      />
      <Skeleton className="mt-16 h-72" />
    </div>
  );
}
