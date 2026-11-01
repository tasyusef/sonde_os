import { Link } from "react-router";
import { truncateAddress } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";

export function AddressLink({
  address,
  truncate = true,
  chars = 5,
  className,
}: {
  address: string;
  truncate?: boolean;
  chars?: number;
  className?: string;
}) {
  return (
    <Link
      to={`/account/${address}`}
      className={cn("link inline-block font-mono text-cell text-primary", className)}
    >
      {truncate ? truncateAddress(address, chars) : address}
    </Link>
  );
}

export default AddressLink;
