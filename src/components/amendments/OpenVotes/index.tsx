import AmendmentName from "@/components/amendments/AmendmentName";
import VoteBar from "@/components/amendments/VoteBar";
import Section from "@/components/shared/Section";
import type { VoteTally } from "@/lib/amendment-votes";
import { cn } from "@/lib/utils";
import type { AmendmentInfo } from "@/types/amendments";
import { cell, thClass } from "@/lib/table";

/**
 * The amendments validators are voting on, closest to activating first:
 * one bar cell per UNL validator, the count, and how far each is from a
 * majority (or when its majority activates it).
 *
 *   Mobile (<lg): Amendment (+ bar, status) | Votes
 *   lg+:          Amendment | Votes (bar + count) | Status
 */
export default function OpenVotes({ rows, tally }: { rows: AmendmentInfo[]; tally: VoteTally | null }) {
  const rule = rows.find((r) => r.votes)?.votes;
  const note = tally
    ? `Votes from the ${tally.unl} validators on the default UNL, via ${tally.source}.`
    : rule
      ? null
      : "Vote counts couldn't be loaded.";

  return (
    <Section title="Open votes" count={rows.length} note={note}>
      {rule && (
        <p className="mb-4 font-body text-ui leading-read-sm text-muted">
          An amendment activates after at least {rule.needed} of the {rule.of} validators back it for
          two weeks straight.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="font-mono text-cell text-muted">No amendments are being voted on.</p>
      ) : (
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-auto" />
            <col className="w-16 lg:w-72" />
            <col className="hidden lg:table-column lg:w-44" />
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={`${thClass} text-left`}>
                Amendment
              </th>
              <th scope="col" className={`${thClass} text-right max-lg:pr-0`}>
                Votes
              </th>
              <th scope="col" className={`${thClass} hidden text-left lg:table-cell`}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.hash} className="border-b border-line last:border-b-0 hover:bg-row-hover">
                <td className={`${cell} align-top`}>
                  <AmendmentName amendment={row} />
                  {/* Mobile-only bar and status; their own columns from lg. */}
                  {row.votes && <VoteBar votes={row.votes} className="mt-2 lg:hidden" />}
                  <Status amendment={row} className="mt-1 lg:hidden" />
                </td>
                <td className={`${cell} align-top max-lg:pr-0`}>
                  <span className="flex items-center justify-end gap-3">
                    {row.votes && <VoteBar votes={row.votes} className="hidden lg:flex" />}
                    <Count amendment={row} />
                  </span>
                </td>
                <td className={`${cell} hidden align-top lg:table-cell`}>
                  <Status amendment={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Count({ amendment: { votes } }: { amendment: AmendmentInfo }) {
  if (!votes) return <span className="font-mono text-cell text-muted">—</span>;
  // Fixed width, so "9/35" doesn't shift its bar out of line.
  return (
    <span className="w-10 shrink-0 text-right font-mono text-cell tabular-nums text-primary">
      <span aria-hidden="true">
        {votes.yes}/{votes.of}
      </span>
      <span className="sr-only">
        {votes.yes} of {votes.of} validators
      </span>
    </span>
  );
}

/** A majority and when it activates, else how many votes it still needs. */
function Status({
  amendment: { hasMajority, activatesAt, votes },
  className,
}: {
  amendment: AmendmentInfo;
  className?: string;
}) {
  if (hasMajority || (votes && votes.yes >= votes.needed)) {
    return (
      <span className={cn("block font-mono text-cell text-success", className)}>
        Majority
        {activatesAt && (
          <span className="block text-tag text-muted">
            Activates <time dateTime={activatesAt}>{activatesAt.slice(0, 10)}</time>
          </span>
        )}
      </span>
    );
  }
  if (!votes) return null;
  return (
    <span className={cn("block font-mono text-cell text-muted", className)}>
      {votes.needed - votes.yes} more needed
    </span>
  );
}

export { OpenVotes };
