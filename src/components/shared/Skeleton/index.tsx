import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse motion-reduce:animate-none rounded-lg bg-elevated", className)} />
  );
}

export default Skeleton;
