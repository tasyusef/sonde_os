import { Skeleton } from "@/components/shared/Skeleton";
import DemoCard from "../shared/DemoCard";

export default function SkeletonDemo() {
  return (
    <DemoCard
      name="Skeleton"
      importPath="@/components/shared/Skeleton"
      description="Animated loading placeholder. Size controlled via className. Respects prefers-reduced-motion."
      preview={
        <div className="w-full max-w-sm space-y-4">
          {/* Card skeleton */}
          <div className="space-y-3 rounded-2xl border border-line bg-surface p-5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex gap-3 pt-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </div>

          {/* Single line variants */}
          <div className="flex gap-3">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </div>
      }
      code={`<Skeleton className="h-4 w-3/4" />
<Skeleton className="h-8 w-8 rounded-full" />`}
    />
  );
}
