import { NextResponse, type NextRequest } from "next/server";
import { query as chQuery } from "@/lib/clickhouse-client";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-trace", 10);

/** Per-hop edge cap. Force-graph rendering gets unreadable past ~150
 *  nodes; with the default depth=3 and a 50-edge per-hop cap, we cap
 *  out at ~150 edges in the worst case. Configurable depth pushes
 *  this higher but rarely usefully — UI smooths that with breadth. */
const PER_HOP_EDGE_CAP = 50;

interface TraceParams {
  account: string;
  direction: "incoming" | "outgoing" | "both";
  depth: number;
  minAmount?: number;
  startTime?: number;
  endTime?: number;
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

// `type` rather than `interface` so it satisfies the `Record<string,
// unknown>` constraint chQuery imposes on its row type generic
// (interfaces aren't auto-assignable to that index-signature shape).
type RawEdgeRow = {
  from_account: string;
  to_account: string;
  amount: number | string;
  currency: string;
  timestamp: number | string;
  tx_hash: string;
  rel_type: string;
};

/**
 * Fetch one BFS hop's worth of edges from the current frontier.
 *
 * `direction` semantics mirror the prior Cypher's directional pattern:
 *   - outgoing — edges where the frontier is on the SOURCE side
 *     (from_account on a payment, taker on a DEX trade, since the
 *     ingester wrote DEX_TRADE as taker → maker)
 *   - incoming — frontier is on the SINK side
 *   - both — frontier is on either side
 *
 * For payments amount is `amount_drops` for XRP, falling back to the
 * lossy float of `amount_iou` for IOU transfers — matching what the
 * Neo4j PAYMENT edge stored as `r.amount` (single field across both
 * currency kinds; consumer uses `currency` to interpret magnitude).
 * For DEX trades amount is `xrp_volume_drops` (XRP-equivalent volume).
 */
async function fetchHopEdges(
  frontier: string[],
  direction: "incoming" | "outgoing" | "both",
  minAmount: number | undefined,
  startTime: number | undefined,
  endTime: number | undefined,
): Promise<RawEdgeRow[]> {
  if (frontier.length === 0) return [];

  const params: Record<string, unknown> = { frontier };

  let minAmountVteClause = "";
  let minAmountDexClause = "";
  if (minAmount != null) {
    params.minAmount = minAmount;
    // amount_drops is Int64, xrp_volume_drops is Int64. Compare as
    // Float64 so the user-supplied threshold can be fractional.
    minAmountVteClause = "AND toFloat64(amount_drops) >= {minAmount:Float64}";
    minAmountDexClause = "AND toFloat64(xrp_volume_drops) >= {minAmount:Float64}";
  }
  let timeClauseVte = "";
  let timeClauseDex = "";
  if (startTime != null) {
    params.startTime = startTime;
    timeClauseVte += " AND toUnixTimestamp(timestamp) >= {startTime:Int64}";
    timeClauseDex += " AND toUnixTimestamp(timestamp) >= {startTime:Int64}";
  }
  if (endTime != null) {
    params.endTime = endTime;
    timeClauseVte += " AND toUnixTimestamp(timestamp) <= {endTime:Int64}";
    timeClauseDex += " AND toUnixTimestamp(timestamp) <= {endTime:Int64}";
  }

  let vteSideClause: string;
  let dexSideClause: string;
  if (direction === "outgoing") {
    vteSideClause = "from_account IN ({frontier:Array(String)})";
    dexSideClause = "taker IN ({frontier:Array(String)})";
  } else if (direction === "incoming") {
    vteSideClause = "to_account IN ({frontier:Array(String)})";
    dexSideClause = "maker IN ({frontier:Array(String)})";
  } else {
    vteSideClause =
      "(from_account IN ({frontier:Array(String)}) OR to_account IN ({frontier:Array(String)}))";
    dexSideClause =
      "(taker IN ({frontier:Array(String)}) OR maker IN ({frontier:Array(String)}))";
  }

  params.cap = PER_HOP_EDGE_CAP;

  const sql = `
    SELECT
      from_account,
      to_account,
      amount,
      currency,
      toUnixTimestamp(timestamp) AS timestamp,
      tx_hash,
      rel_type
    FROM (
      SELECT
        from_account,
        to_account,
        if(amount_drops > 0, toFloat64(amount_drops), toFloat64OrZero(amount_iou)) AS amount,
        currency,
        timestamp,
        tx_hash,
        'PAYMENT' AS rel_type
      FROM value_transfer_events
      WHERE ${vteSideClause}
        AND from_account != ''
        AND to_account != ''
        ${minAmountVteClause}
        ${timeClauseVte}
      UNION ALL
      SELECT
        taker AS from_account,
        maker AS to_account,
        toFloat64(xrp_volume_drops) AS amount,
        base_currency AS currency,
        timestamp,
        tx_hash,
        'DEX_TRADE' AS rel_type
      FROM dex_trades
      WHERE ${dexSideClause}
        AND taker != ''
        AND maker != ''
        ${minAmountDexClause}
        ${timeClauseDex}
    )
    ORDER BY timestamp DESC
    LIMIT {cap:UInt32}
  `;

  return chQuery<RawEdgeRow>(sql, params);
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  let body: TraceParams;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { account, direction = "both", depth = 3, minAmount, startTime, endTime } = body;

  if (!account || !XRPL_ADDRESS_RE.test(account)) {
    return NextResponse.json({ error: "Valid XRPL account address required" }, { status: 400 });
  }
  if (!["incoming", "outgoing", "both"].includes(direction)) {
    return NextResponse.json(
      { error: "direction must be 'incoming', 'outgoing', or 'both'" },
      { status: 400 },
    );
  }
  const rawDepth = Number(depth);
  if (!Number.isFinite(rawDepth)) {
    return NextResponse.json({ error: "depth must be a number" }, { status: 400 });
  }
  const clampedDepth = Math.min(Math.max(1, Math.floor(rawDepth)), 6);

  let validatedMinAmount: number | undefined;
  if (minAmount != null) {
    const n = Number(minAmount);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "minAmount must be a number" }, { status: 400 });
    }
    validatedMinAmount = n;
  }
  let validatedStartTime: number | undefined;
  if (startTime != null) {
    const n = Number(startTime);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "startTime must be a number" }, { status: 400 });
    }
    validatedStartTime = n;
  }
  let validatedEndTime: number | undefined;
  if (endTime != null) {
    const n = Number(endTime);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "endTime must be a number" }, { status: 400 });
    }
    validatedEndTime = n;
  }

  try {
    // BFS frontier expansion. Pre-2026-04-30 this was a Cypher
    // variable-length pattern (`-[:PAYMENT|DEX_TRADE*1..N]-`); CH
    // doesn't have native graph traversal, so we expand hop-by-hop in
    // process. Each hop is one bloom-filter-indexed CH query.
    const visited = new Set<string>([account]);
    const allNodes = new Map<string, PathNode>([
      [account, { address: account, first_seen: null, last_active: null }],
    ]);
    const allEdges: PathEdge[] = [];
    const edgeKeys = new Set<string>();
    let frontier: string[] = [account];

    for (let hop = 0; hop < clampedDepth && frontier.length > 0; hop++) {
      const rows = await fetchHopEdges(
        frontier,
        direction,
        validatedMinAmount,
        validatedStartTime,
        validatedEndTime,
      );

      const nextFrontier = new Set<string>();
      for (const r of rows) {
        const edgeKey = `${r.tx_hash}|${r.from_account}|${r.to_account}`;
        if (edgeKeys.has(edgeKey)) continue;
        edgeKeys.add(edgeKey);

        allEdges.push({
          from: r.from_account,
          to: r.to_account,
          amount: Number(r.amount) || 0,
          currency: r.currency || "XRP",
          timestamp: Number(r.timestamp) || 0,
          tx_hash: r.tx_hash,
          type: r.rel_type,
        });

        for (const addr of [r.from_account, r.to_account]) {
          if (!allNodes.has(addr)) {
            allNodes.set(addr, { address: addr, first_seen: null, last_active: null });
          }
          if (!visited.has(addr)) {
            nextFrontier.add(addr);
          }
        }
      }

      for (const a of nextFrontier) visited.add(a);
      frontier = Array.from(nextFrontier);
    }

    // Backfill first_seen / last_active for every node we collected.
    // Neo4j stored these as node properties at write time; CH derives
    // them on read from the partition-pruned transactions table.
    if (allNodes.size > 0) {
      const addresses = Array.from(allNodes.keys());
      try {
        const timeRows = await chQuery<{
          account: string;
          first_seen: number | string | null;
          last_active: number | string | null;
        }>(
          `SELECT
             account,
             toUnixTimestamp(min(timestamp)) AS first_seen,
             toUnixTimestamp(max(timestamp)) AS last_active
           FROM transactions
           WHERE account IN ({addresses:Array(String)})
           GROUP BY account`,
          { addresses },
        );
        for (const r of timeRows) {
          const node = allNodes.get(r.account);
          if (node) {
            node.first_seen = r.first_seen != null ? Number(r.first_seen) : null;
            node.last_active = r.last_active != null ? Number(r.last_active) : null;
          }
        }
      } catch {
        // First/last fill is best-effort; UI handles null gracefully.
      }
    }

    return NextResponse.json({
      account,
      direction,
      depth: clampedDepth,
      // Path count is undefined under BFS (paths and edges aren't
      // 1:1); report distinct edge count as the closest analog.
      pathCount: allEdges.length,
      graph: {
        nodes: Array.from(allNodes.values()),
        edges: allEdges,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/intel/trace] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
