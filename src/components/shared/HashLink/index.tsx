import Link from "next/link";
import { truncateHash } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";

export function HashLink({
  hash,
  truncate = true,
  chars = 5,
  className,
}: {
  hash: string;
  truncate?: boolean;
  chars?: number;
  className?: string;
}) {
  return (
    <Link
      href={`/tx/${hash}`}
      className={cn(
        "group relative inline-block font-mono text-cell text-muted transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm",
        className
      )}
    >
      <span className="relative">
        {truncate ? truncateHash(hash, chars) : hash}
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 left-0 h-px w-full origin-left scale-x-0 bg-current transition-transform duration-200 ease-out group-hover:scale-x-100"
        />
      </span>
    </Link>
  );
}

export default HashLink;
