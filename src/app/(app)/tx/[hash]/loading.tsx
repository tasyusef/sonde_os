import Skeleton from "@/components/shared/Skeleton";

export default function TxLoading() {
  return (
    <div className="min-h-screen" role="status" aria-label="Loading transaction">
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-center gap-3">
          <Skeleton className="h-[28px] w-[160px]" />
          <Skeleton className="h-[20px] w-[80px] rounded-lg" />
          <Skeleton className="h-[20px] w-[70px] rounded-full" />
        </div>
        <Skeleton className="mb-6 h-[14px] w-[500px] max-w-full" />
        <div className="rounded-2xl shadow-card">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex border-b border-elevated px-4 py-3">
              <Skeleton className="h-[12px] w-[120px]" />
              <Skeleton className="ml-8 h-[12px] w-[300px] max-w-full" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
