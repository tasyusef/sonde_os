/**
 * Query functions for reading amendment data from Postgres.
 * Used by the /api/amendments/* routes.
 *
 * All queries include a 30s in-memory response cache.
 */

import "server-only";
import { sql, desc, eq, and, inArray, gte } from "drizzle-orm";
import { db } from "@/db";
import { amendments, amendmentVotes } from "@/db/schema";
import { LRUCache } from "./cache";
import type {
  AmendmentInfo,
  AmendmentVotePoint,
  AmendmentSummary,
} from "@/types/amendments";

/* ------------------------------------------------------------------ */
/*  Response cache (30s TTL)                                           */
/* ------------------------------------------------------------------ */

const amendmentCache = new LRUCache<unknown>(30, 30_000);

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type Filter = "pending" | "majority" | "enabled" | "all";
type Period = "7d" | "30d" | "90d" | "all";

/* ------------------------------------------------------------------ */
/*  Get all amendments with latest vote status                         */
/* ------------------------------------------------------------------ */

export async function getAmendments(
  filter: Filter = "all",
): Promise<AmendmentInfo[]> {
  const cacheKey = `amendments:${filter}`;
  const cached = amendmentCache.get(cacheKey) as AmendmentInfo[] | undefined;
  if (cached) return cached;

  // Get all amendment metadata
  const allAmendments = await db.select().from(amendments);

  // Get latest vote snapshot for each amendment
  const latestVotes = await db.execute<{
    amendment_hash: string;
    yes_count: number;
    threshold: number;
    total_validators: number;
    has_majority: boolean;
  }>(sql`
    SELECT DISTINCT ON (amendment_hash)
      amendment_hash, yes_count, threshold, total_validators, has_majority
    FROM amendment_votes
    ORDER BY amendment_hash, recorded_at DESC
  `);

  const voteMap = new Map(
    latestVotes.map((v) => [v.amendment_hash, v]),
  );

  let result: AmendmentInfo[] = allAmendments.map((a) => {
    const vote = voteMap.get(a.hash);
    const totalValidators = vote?.total_validators ?? 0;
    const yesCount = vote?.yes_count ?? 0;

    return {
      hash: a.hash,
      name: a.name,
      enabled: a.enabled,
      enabledAt: a.enabledAt?.toISOString() ?? null,
      currentYesCount: yesCount,
      threshold: vote?.threshold ?? 0,
      totalValidators,
      hasMajority: vote?.has_majority ?? false,
      majorityPercent:
        totalValidators > 0
          ? Math.round((yesCount / totalValidators) * 100)
          : 0,
    };
  });

  // Apply filter
  switch (filter) {
    case "pending":
      result = result.filter((a) => !a.enabled && !a.hasMajority);
      break;
    case "majority":
      result = result.filter((a) => !a.enabled && a.hasMajority);
      break;
    case "enabled":
      result = result.filter((a) => a.enabled);
      break;
  }

  // Sort: pending amendments by majority percent desc, enabled at bottom
  result.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? 1 : -1;
    return b.majorityPercent - a.majorityPercent;
  });

  amendmentCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Get vote history for one amendment                                 */
/* ------------------------------------------------------------------ */

export async function getAmendmentVoteHistory(
  hash: string,
  period: Period = "30d",
): Promise<AmendmentVotePoint[]> {
  const cacheKey = `amendment-history:${hash}:${period}`;
  const cached = amendmentCache.get(cacheKey) as
    | AmendmentVotePoint[]
    | undefined;
  if (cached) return cached;

  const cutoff = periodToCutoff(period);

  const rows = await db
    .select({
      recordedAt: amendmentVotes.recordedAt,
      yesCount: amendmentVotes.yesCount,
      threshold: amendmentVotes.threshold,
      totalValidators: amendmentVotes.totalValidators,
    })
    .from(amendmentVotes)
    .where(
      cutoff
        ? and(
            eq(amendmentVotes.amendmentHash, hash),
            sql`${amendmentVotes.recordedAt} >= ${cutoff}`,
          )
        : eq(amendmentVotes.amendmentHash, hash),
    )
    .orderBy(amendmentVotes.recordedAt);

  const result: AmendmentVotePoint[] = rows.map((r) => ({
    timestamp: r.recordedAt.getTime(),
    yesCount: r.yesCount,
    threshold: r.threshold,
    totalValidators: r.totalValidators,
    percent:
      r.totalValidators > 0
        ? Math.round((r.yesCount / r.totalValidators) * 100)
        : 0,
  }));

  amendmentCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Batch vote histories — N hashes in one query                       */
/* ------------------------------------------------------------------ */

/**
 * Fetch vote history points for many amendments in a single PG query.
 * Replaces the per-hash fan-out (one query per amendment, up to 50)
 * the network page used to drive sparkline rendering — that path
 * walked PG 50× per page load, each query an indexed point lookup but
 * still 50 round-trips of latency.
 *
 * Returns a Map keyed on amendment hash. Hashes with no rows in range
 * map to an empty array. Sorting within each amendment is by
 * `recordedAt` ASC (matches the single-hash helper).
 *
 * `inArray()` is the right Drizzle primitive here — see the project
 * note on the `sql\`col = ANY(${jsArray})\`` bug that ROW-ifies the
 * input.
 */
export async function getAmendmentVoteHistoriesBatch(
  hashes: string[],
  period: Period = "30d",
): Promise<Map<string, AmendmentVotePoint[]>> {
  if (hashes.length === 0) return new Map();

  const cutoff = periodToCutoff(period);
  const rows = await db
    .select({
      amendmentHash: amendmentVotes.amendmentHash,
      recordedAt: amendmentVotes.recordedAt,
      yesCount: amendmentVotes.yesCount,
      threshold: amendmentVotes.threshold,
      totalValidators: amendmentVotes.totalValidators,
    })
    .from(amendmentVotes)
    .where(
      cutoff
        ? and(
            inArray(amendmentVotes.amendmentHash, hashes),
            gte(amendmentVotes.recordedAt, new Date(cutoff)),
          )
        : inArray(amendmentVotes.amendmentHash, hashes),
    )
    .orderBy(amendmentVotes.amendmentHash, amendmentVotes.recordedAt);

  const result = new Map<string, AmendmentVotePoint[]>();
  for (const hash of hashes) result.set(hash, []);
  for (const r of rows) {
    const point: AmendmentVotePoint = {
      timestamp: r.recordedAt.getTime(),
      yesCount: r.yesCount,
      threshold: r.threshold,
      totalValidators: r.totalValidators,
      percent:
        r.totalValidators > 0
          ? Math.round((r.yesCount / r.totalValidators) * 100)
          : 0,
    };
    result.get(r.amendmentHash)?.push(point);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Get single amendment info                                          */
/* ------------------------------------------------------------------ */

export async function getAmendmentInfo(
  hash: string,
): Promise<AmendmentInfo | null> {
  const cacheKey = `amendment-info:${hash}`;
  const cached = amendmentCache.get(cacheKey) as AmendmentInfo | undefined;
  if (cached) return cached;

  const [row] = await db
    .select()
    .from(amendments)
    .where(eq(amendments.hash, hash))
    .limit(1);

  if (!row) return null;

  const [vote] = await db
    .select()
    .from(amendmentVotes)
    .where(eq(amendmentVotes.amendmentHash, hash))
    .orderBy(desc(amendmentVotes.recordedAt))
    .limit(1);

  const totalValidators = vote?.totalValidators ?? 0;
  const yesCount = vote?.yesCount ?? 0;

  const result: AmendmentInfo = {
    hash: row.hash,
    name: row.name,
    enabled: row.enabled,
    enabledAt: row.enabledAt?.toISOString() ?? null,
    currentYesCount: yesCount,
    threshold: vote?.threshold ?? 0,
    totalValidators,
    hasMajority: vote?.hasMajority ?? false,
    majorityPercent:
      totalValidators > 0
        ? Math.round((yesCount / totalValidators) * 100)
        : 0,
  };

  amendmentCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Summary stats                                                      */
/* ------------------------------------------------------------------ */

export async function getAmendmentSummary(): Promise<AmendmentSummary> {
  const cacheKey = "amendment-summary";
  const cached = amendmentCache.get(cacheKey) as AmendmentSummary | undefined;
  if (cached) return cached;

  const allAmendments = await getAmendments("all");

  const result: AmendmentSummary = {
    totalKnown: allAmendments.length,
    enabled: allAmendments.filter((a) => a.enabled).length,
    pending: allAmendments.filter((a) => !a.enabled && !a.hasMajority).length,
    withMajority: allAmendments.filter((a) => !a.enabled && a.hasMajority)
      .length,
  };

  amendmentCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function periodToCutoff(period: Period): string | null {
  const now = new Date();
  switch (period) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    case "all":
      return null;
  }
}
