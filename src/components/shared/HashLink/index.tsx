import { Link } from "react-router";
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
      to={`/tx/${hash}`}
      className={cn("link inline-block font-mono text-cell text-muted", className)}
      title={truncate ? hash : undefined}
    >
      {truncate ? truncateHash(hash, chars) : hash}
    </Link>
  );
}

export default HashLink;
