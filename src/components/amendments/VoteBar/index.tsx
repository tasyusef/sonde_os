import { Fragment } from "react";
import type { AmendmentVotes } from "@/types/amendments";
import { cn } from "@/lib/utils";

/**
 * One cell per UNL validator, filled for each yes vote, with a mark
 * where the fill must reach for a majority. Decorative: the count
 * beside it carries the numbers.
 */
export default function VoteBar({ votes, className }: { votes: AmendmentVotes; className?: string }) {
  const { yes, of, needed } = votes;
  return (
    <span aria-hidden="true" className={cn("flex flex-wrap items-center gap-0.5", className)}>
      {Array.from({ length: of }, (_, i) => (
        <Fragment key={i}>
          {i === needed - 1 && <span className="h-4 w-0.5 bg-muted" />}
          <span className={cn("h-2 w-1", i < yes ? "bg-primary" : "bg-dither-strong")} />
        </Fragment>
      ))}
    </span>
  );
}

export { VoteBar };
