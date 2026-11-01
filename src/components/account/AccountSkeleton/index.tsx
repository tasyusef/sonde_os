import Skeleton from "@/components/shared/Skeleton";

/* Stand-ins for the account page's parts while `account_info` loads,
   each in its part's shape. The hero needs none: it renders from the URL. */

export function BalanceSkeleton() {
  return (
    <div role="status" aria-label="Loading account">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-2 h-10 w-2/3 sm:h-14" />
      <Skeleton className="mt-1 h-4 w-24" />
    </div>
  );
}

export function DetailsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <Skeleton className="h-4 w-20" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-4" />
      ))}
    </div>
  );
}

export function TabsSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={className}>
      <div className="flex gap-6 border-b border-line pb-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-20" />
        ))}
      </div>
      <Skeleton className="mt-6 h-96" />
    </div>
  );
}
