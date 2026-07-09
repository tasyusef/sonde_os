"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Skeleton from "@/components/shared/Skeleton";
import AllocationChart from "@/components/portfolio/AllocationChart";
import TopMovers from "@/components/portfolio/TopMovers";
import ReturnsChart from "@/components/portfolio/MonthlyReturns";

// Below-fold cards are deferred until their sentinel scrolls near the viewport.
// They each pull recharts + their own SWR fetch, so keeping them out of the
// initial Overview render saves significant JS + network on first paint.
const OverviewBelowFold = dynamic(() => import("./BelowFold"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-[280px] rounded-2xl" />
      <Skeleton className="h-[200px] rounded-2xl" />
      <Skeleton className="h-[280px] rounded-2xl" />
    </div>
  ),
});

export default function OverviewPanel() {
  const [shouldMountBelowFold, setShouldMountBelowFold] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldMountBelowFold(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <TopMovers />
      <AllocationChart />
      <ReturnsChart />
      {shouldMountBelowFold ? (
        <OverviewBelowFold />
      ) : (
        <div
          ref={sentinelRef}
          aria-hidden="true"
          className="min-h-[600px]"
        />
      )}
    </div>
  );
}
