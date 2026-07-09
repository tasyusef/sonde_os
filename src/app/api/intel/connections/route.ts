import { NextResponse, type NextRequest } from "next/server";
import { query as chQuery } from "@/lib/clickhouse-client";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-connections", 10);

/** Cap on the number of shared counterparties surfaced. The original
 *  Cypher returned up to 50 path matches; matching that here keeps the
 *  returned star graph (source + target + N intermediaries) within the
 *  ~150-node force-graph readability ceiling. */
const MAX_COMMON = 50;

interface ConnectionParams {
  source: string;
  target: string;
}

interface CommonCounterparty {
  address: string;
  txCountToSource: number;
  txCountToTarget: number;
}

interface PathNode {
  address: string;
  first_seen: number | null;
  last_active: number | null;
}

interface PathEdge {
  from: string;
  to: string;
  amount: number;
  currency: string;
  timestamp: number;
  tx_hash: string;
  type: string;
}

/**
 * Find every account that has interacted with `addr` in either source
 * table. Returns the deduped counterparty set used for the
 * intersection step below.
 */
async function counterpartySet(addr: string): Promise<Set<string>> {
  const rows = await chQuery<{ counterparty: string }>(
    `SELECT DISTINCT counterparty
     FROM (
       SELECT to_account AS counterparty FROM value_transfer_events
         WHERE from_account = {addr:String}
           AND to_account != ''
           AND to_account != {addr:String}
       UNION ALL
       SELECT from_account AS counterparty FROM value_transfer_events
         WHERE to_account = {addr:String}
           AND from_account != ''
           AND from_account != {addr:String}
       UNION ALL
       SELECT maker AS counterparty FROM dex_trades
         WHERE taker = {addr:String}
           AND maker != ''
           AND maker != {addr:String}
       UNION ALL
       SELECT taker AS counterparty FROM dex_trades
         WHERE maker = {addr:String}
           AND taker != ''
           AND taker != {addr:String}
     )`,
    { addr },
  );
  return new Set(rows.map((r) => r.counterparty));
}

/**
 * For each common counterparty, count edges to `addr` across both
 * source tables. Used to populate per-side tx counts in the response.
 */
async function txCountsByCounterparty(
  addr: string,
  commons: string[],
): Promise<Map<string, number>> {
  if (commons.length === 0) return new Map();
  const rows = await chQuery<{ counterparty: string; tx_count: number | string }>(
    `SELECT counterparty, count() AS tx_count
     FROM (
       SELECT to_account AS counterparty FROM value_transfer_events
         WHERE from_account = {addr:String}
           AND to_account IN ({commons:Array(String)})
       UNION ALL
       SELECT from_account AS counterparty FROM value_transfer_events
         WHERE to_account = {addr:String}
           AND from_account IN ({commons:Array(String)})
       UNION ALL
       SELECT maker AS counterparty FROM dex_trades
         WHERE taker = {addr:String}
           AND maker IN ({commons:Array(String)})
       UNION ALL
       SELECT taker AS counterparty FROM dex_trades
         WHERE maker = {addr:String}
           AND taker IN ({commons:Array(String)})
     )
     GROUP BY counterparty`,
    { addr, commons },
  );
  return new Map(rows.map((r) => [r.counterparty, Number(r.tx_count) || 0]));
}

/**
 * Connections API — replaced 2026-04-30 alongside the Neo4j removal.
 *
 * The prior implementation ran Cypher's `allShortestPaths` between
 * source and target, which has no clean SQL replacement. CH-native
 * pathfinding via iterative CTEs is slow on dense accounts and
 * structurally awkward; an in-process BFS over a precomputed pair-edges
 * MV would work but adds another moving part.
 *
 * Replacing the feature with "common counterparties" lands in the
 * same UX neighborhood — "what's the relationship between these two
 * addresses" — and is a clean intersect on the partition-pruned
 * vte / dex_trades scans we already use elsewhere. See
 * `docs/plans/neo4j-removal.md` §6.
 *
 * Response keeps `pathCount` as an alias for `commonCount` so the
 * GraphStats UI can render unmodified during the cutover.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  let body: ConnectionParams;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { source, target } = body;
  if (!source || !XRPL_ADDRESS_RE.test(source)) {
    return NextResponse.json({ error: "Valid source address required" }, { status: 400 });
  }
  if (!target || !XRPL_ADDRESS_RE.test(target)) {
    return NextResponse.json({ error: "Valid target address required" }, { status: 400 });
  }
  if (source === target) {
    return NextResponse.json({ error: "Source and target must be different" }, { status: 400 });
  }

  try {
    // Fetch counterparty sets for both addresses in parallel.
    const [sourceCps, targetCps] = await Promise.all([
      counterpartySet(source),
      counterpartySet(target),
    ]);

    // Intersect, exclude the two principals, cap.
    const commons: string[] = [];
    for (const cp of sourceCps) {
      if (cp === source || cp === target) continue;
      if (targetCps.has(cp)) {
        commons.push(cp);
        if (commons.length >= MAX_COMMON) break;
      }
    }

    // Per-side tx counts — used to size edges in the star graph and
    // populate the table view.
    const [sourceCountsMap, targetCountsMap] = await Promise.all([
      txCountsByCounterparty(source, commons),
      txCountsByCounterparty(target, commons),
    ]);

    const commonCounterparties: CommonCounterparty[] = commons.map((address) => ({
      address,
      txCountToSource: sourceCountsMap.get(address) ?? 0,
      txCountToTarget: targetCountsMap.get(address) ?? 0,
    }));

    // Star graph: source + target + every common as a node, with
    // synthetic edges source → common → target. Lets the existing
    // GraphView render a recognizable "what they share" picture
    // without a UI rewrite.
    const nodes: PathNode[] = [
      { address: source, first_seen: null, last_active: null },
      { address: target, first_seen: null, last_active: null },
      ...commons.map((c) => ({ address: c, first_seen: null, last_active: null })),
    ];
    const edges: PathEdge[] = [];
    for (const cp of commonCounterparties) {
      edges.push({
        from: source,
        to: cp.address,
        amount: cp.txCountToSource,
        currency: "TX",
        timestamp: 0,
        tx_hash: `synthetic-${source}-${cp.address}`,
        type: "SHARED",
      });
      edges.push({
        from: cp.address,
        to: target,
        amount: cp.txCountToTarget,
        currency: "TX",
        timestamp: 0,
        tx_hash: `synthetic-${cp.address}-${target}`,
        type: "SHARED",
      });
    }

    return NextResponse.json({
      source,
      target,
      connected: commons.length > 0,
      commonCount: commons.length,
      // Alias for back-compat with the UI's pathCount-based stats.
      pathCount: commons.length,
      commonCounterparties,
      graph: { nodes, edges },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/intel/connections] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
