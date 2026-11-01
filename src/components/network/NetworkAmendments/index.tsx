import { useMemo } from "react";
import AmendmentTable from "@/components/amendments/AmendmentTable";
import OpenVotes from "@/components/amendments/OpenVotes";
import PageAlert, { UNREACHABLE_MESSAGE } from "@/components/shared/PageAlert";
import Skeleton from "@/components/shared/Skeleton";
import { useAmendments } from "@/hooks/useAmendments";
import { useVoteTally } from "@/hooks/useVoteTally";
import { applyTally, groupAmendments } from "@/lib/amendments";

/**
 * Amendments tab: status from the node over the browser socket, votes
 * from a vote service. It waits for both (or the votes failing), so
 * rows don't jump between sections once the votes arrive.
 */
export default function NetworkAmendments() {
  const { amendments, failed, unreachable, retry } = useAmendments();
  const { tally, settled } = useVoteTally();
  const groups = useMemo(
    () => amendments && groupAmendments(tally ? applyTally(amendments, tally) : amendments),
    [amendments, tally],
  );

  if (unreachable) return <PageAlert message={UNREACHABLE_MESSAGE} onRetry={retry} />;
  if (failed) {
    return <PageAlert message="Couldn't load amendments from the network." onRetry={retry} />;
  }
  if (!groups || !settled) return <AmendmentsSkeleton />;
  return (
    <div className="space-y-16">
      <OpenVotes rows={groups.voting} tally={tally} />
      <AmendmentTable title="Enabled" rows={groups.enabled} dated />
      {groups.idle.length > 0 && (
        <AmendmentTable
          title="No votes"
          rows={groups.idle}
          note="Known to the network, but no validator on the default UNL votes for them."
        />
      )}
    </div>
  );
}

function AmendmentsSkeleton() {
  return (
    <div role="status" aria-label="Loading amendments" className="space-y-3">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}
