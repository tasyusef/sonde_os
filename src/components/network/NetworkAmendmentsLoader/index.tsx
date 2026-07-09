import AmendmentSummaryBar from "@/components/amendments/AmendmentSummaryBar";
import AmendmentList from "@/components/amendments/AmendmentList";
import {
  getAmendments,
  getAmendmentVoteHistoriesBatch,
} from "@/lib/amendment-queries";
import type { AmendmentSummary, AmendmentVotePoint } from "@/types/amendments";

/**
 * Async server component — fetches amendments + sparkline vote history.
 * Wrapped in <Suspense> by network/page.tsx so Tier 1 content renders instantly.
 */
export default async function NetworkAmendmentsLoader() {
  const amendmentsList = await getAmendments("all").catch(() => []);

  if (amendmentsList.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-body text-body text-muted">
          Collecting amendment data...
        </p>
        <p className="mt-1 font-body text-cell text-muted">
          Amendment voting snapshots will appear here once the tracker
          has polled the network.
        </p>
      </div>
    );
  }

  const amendmentSummary: AmendmentSummary = {
    totalKnown: amendmentsList.length,
    enabled: amendmentsList.filter((a) => a.enabled).length,
    pending: amendmentsList.filter((a) => !a.enabled && !a.hasMajority).length,
    withMajority: amendmentsList.filter((a) => !a.enabled && a.hasMajority).length,
  };

  // Fetch sparkline data for non-enabled amendments (last 7 days).
  // Cap at 50 to bound the SQL `IN` list size if amendment set grows
  // large — single batched PG query, replaces the prior per-hash
  // fan-out (50 serial PG queries per page load).
  const pendingAmendments = amendmentsList.filter((a) => !a.enabled).slice(0, 50);
  const sparklineMap: Record<string, AmendmentVotePoint[]> = {};

  if (pendingAmendments.length > 0) {
    const histories = await getAmendmentVoteHistoriesBatch(
      pendingAmendments.map((a) => a.hash),
      "7d",
    ).catch(() => new Map<string, AmendmentVotePoint[]>());
    for (const [hash, history] of histories) {
      sparklineMap[hash] = history;
    }
  }

  return (
    <>
      <AmendmentSummaryBar summary={amendmentSummary} />
      <AmendmentList initialAmendments={amendmentsList} sparklineMap={sparklineMap} />
    </>
  );
}
