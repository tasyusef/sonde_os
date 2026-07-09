import Skeleton from "@/components/shared/Skeleton";

export default function TokensLoading() {
  return (
    <div className="min-h-screen" role="status" aria-label="Loading tokens">
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <Skeleton className="mb-2 h-[28px] w-[120px]" />
        <Skeleton className="mb-6 h-[14px] w-[220px]" />
        <Skeleton className="mb-4 h-[40px] w-[300px] max-w-full rounded-2xl" />
        <Skeleton className="h-[600px] rounded-2xl" />
      </main>
    </div>
  );
}
