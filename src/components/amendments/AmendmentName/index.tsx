import CopyButton from "@/components/shared/CopyButton";
import { cn } from "@/lib/utils";
import { truncateHash } from "@/lib/xrpl-helpers";
import type { AmendmentInfo } from "@/types/amendments";

/** An amendment's name over its ID, which copies. Unnamed ones show
 *  the ID alone. */
export default function AmendmentName({ amendment }: { amendment: AmendmentInfo }) {
  const { hash, name } = amendment;
  const named = name !== hash;
  return (
    <>
      {named && <span className="block break-words font-mono text-cell text-primary">{name}</span>}
      <span
        className={cn(
          "flex items-center gap-1 font-mono",
          named ? "text-tag text-muted" : "text-cell text-primary",
        )}
      >
        <span className="sr-only">ID </span>
        {truncateHash(hash)}
        {/* The button's tap padding mustn't make the row taller. */}
        <span className="-my-2.5 sm:-my-1.5">
          <CopyButton text={hash} />
        </span>
      </span>
    </>
  );
}

export { AmendmentName };
