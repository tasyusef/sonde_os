import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getMockHistory } from "@/lib/mock-portfolio";
import { query as chQuery } from "@/lib/clickhouse-client";
import logger from "@/lib/logger";

/** Number of days for each period. */
const PERIOD_DAYS: Record<string, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

/** Max rows returned per query. Safety net for period-filtered queries. */
const MAX_ROWS = 5000;

/**
 * Threshold for downsampling: full-resolution snapshots for the last
 * 90 days, daily averages older. Mirrors the PG implementation.
 */
const DOWNSAMPLE_RECENT_DAYS = 90;

interface TokenBreakdownEntry {
  currency: string;
  issuer: string;
  name: string;
  balance: number;
  usd: number;
}

/**
 * NOTE on the column aliases below: we deliberately avoid aliasing
 * `toString(snapshot_time) AS snapshot_time`. CH 26+ resolves SELECT
 * aliases inside `WHERE` / `ORDER BY`, and a same-name `String` alias
 * shadows the `DateTime` column — `WHERE snapshot_time > now() - INTERVAL X DAY`
 * then fails with `NO_COMMON_TYPE`. Same trap that's documented in
 * `src/lib/holder-queries.ts`. Use a distinct alias (`t`) and rename
 * client-side. (Hit Tim's portfolio chart 2026-05-09 — empty state for
 * everyone after the PG → CH cutover.)
 */
interface SnapshotRow extends Record<string, unknown> {
  t: string;
  xrp_balance: string;
  xrp_price_usd: string;
  token_value_usd: string;
  nft_count: string;
  amm_value_usd: string;
  locked_xrp: string;
  total_value_usd: string;
  owner_count: string;
}

/**
 * GET /api/portfolio/history?period=7d|30d|90d|1y|all
 *
 * Returns historical portfolio snapshots for the authenticated user,
 * served from CH `portfolio_snapshots` (PG → CH migration Phase 3,
 * 2026-05-09).
 *
 * For "all": full-resolution for the last 90 days, daily averages
 * older. For period-filtered queries: returns up to MAX_ROWS with a
 * `truncated` flag if hit.
 */
export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get("period") ?? "30d";

  const validPeriods = ["24h", "7d", "30d", "90d", "1y", "all"];
  if (!validPeriods.includes(period)) {
    return NextResponse.json(
      { error: "Invalid period. Must be one of: " + validPeriods.join(", ") },
      { status: 400 },
    );
  }

  if (process.env.MOCK_PORTFOLIO === "true") {
    return NextResponse.json(getMockHistory(period));
  }

  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const days = PERIOD_DAYS[period];

  try {
    let rows: SnapshotRow[];
    let truncated = false;

    if (days) {
      rows = await queryFiltered(session.address, days, MAX_ROWS);
      if (rows.length >= MAX_ROWS) truncated = true;
    } else {
      rows = await queryAllDownsampled(session.address);
    }

    const snapshots = rows.map((r) => ({
      time: r.t,
      xrpBalance: parseFloat(r.xrp_balance) || 0,
      xrpPriceUsd: parseFloat(r.xrp_price_usd) || 0,
      tokenValueUsd: parseFloat(r.token_value_usd) || 0,
      nftCount: parseInt(r.nft_count, 10) || 0,
      ammValueUsd: parseFloat(r.amm_value_usd) || 0,
      lockedXrp: parseFloat(r.locked_xrp) || 0,
      totalValueUsd: parseFloat(r.total_value_usd) || 0,
      ownerCount: parseInt(r.owner_count, 10) || null,
    }));

    // Optionally include token breakdown from earliest snapshot
    const includeTokens = request.nextUrl.searchParams.get(
      "includeTokenBreakdown",
    );
    let earliestTokenBreakdown: TokenBreakdownEntry[] | undefined;

    if (includeTokens === "first" && snapshots.length > 0) {
      try {
        const sql = days
          ? `SELECT token_breakdown FROM portfolio_snapshots
             WHERE address = {addr:String}
               AND snapshot_time > now() - INTERVAL {days:UInt16} DAY
             ORDER BY snapshot_time ASC LIMIT 1`
          : `SELECT token_breakdown FROM portfolio_snapshots
             WHERE address = {addr:String}
             ORDER BY snapshot_time ASC LIMIT 1`;
        const tbRows = await chQuery<{ token_breakdown: string }>(sql, {
          addr: session.address,
          days: days ?? 0,
        });
        if (tbRows.length > 0 && tbRows[0].token_breakdown) {
          try {
            earliestTokenBreakdown = JSON.parse(
              tbRows[0].token_breakdown,
            ) as TokenBreakdownEntry[];
          } catch {
            /* malformed JSON — skip */
          }
        }
      } catch {
        /* non-fatal */
      }
    }

    return NextResponse.json({
      snapshots,
      ...(truncated ? { truncated: true } : {}),
      ...(earliestTokenBreakdown ? { earliestTokenBreakdown } : {}),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/portfolio/history] Error");
    return NextResponse.json(
      { error: "Failed to fetch portfolio history" },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Query helpers                                                      */
/* ------------------------------------------------------------------ */

/** Period-filtered snapshots from CH. Bounded by `now() - days`.
 *
 *  Aliases use `t` for the time column rather than the obvious
 *  `snapshot_time` to avoid CH 26+'s alias-shadowing-in-WHERE behavior;
 *  see the `SnapshotRow` doc comment above. */
async function queryFiltered(
  address: string,
  days: number,
  limit: number,
): Promise<SnapshotRow[]> {
  return chQuery<SnapshotRow>(
    `SELECT
        toString(snapshot_time)             AS t,
        toString(xrp_balance)               AS xrp_balance,
        toString(xrp_price_usd)             AS xrp_price_usd,
        toString(token_value_usd)           AS token_value_usd,
        toString(nft_count)                 AS nft_count,
        toString(amm_value_usd)             AS amm_value_usd,
        toString(locked_xrp)                AS locked_xrp,
        toString(total_value_usd)           AS total_value_usd,
        toString(owner_count)               AS owner_count
     FROM portfolio_snapshots
     WHERE address = {addr:String}
       AND snapshot_time > now() - INTERVAL {days:UInt16} DAY
     ORDER BY snapshot_time ASC
     LIMIT {limit:UInt32}`,
    { addr: address, days, limit },
  );
}

/** All snapshots with downsampling: daily averages older than
 *  DOWNSAMPLE_RECENT_DAYS, full-resolution recent. Single query that
 *  unions the two ranges. */
async function queryAllDownsampled(address: string): Promise<SnapshotRow[]> {
  return chQuery<SnapshotRow>(
    `SELECT * FROM (
       SELECT
         formatDateTime(toStartOfDay(snapshot_time), '%F %T') AS t,
         toString(avg(xrp_balance))                          AS xrp_balance,
         toString(avg(xrp_price_usd))                        AS xrp_price_usd,
         toString(avg(token_value_usd))                      AS token_value_usd,
         toString(toUInt32(round(avg(nft_count))))           AS nft_count,
         toString(avg(amm_value_usd))                        AS amm_value_usd,
         toString(avg(locked_xrp))                           AS locked_xrp,
         toString(avg(total_value_usd))                      AS total_value_usd,
         toString(toUInt32(round(avg(owner_count))))         AS owner_count
       FROM portfolio_snapshots
       WHERE address = {addr:String}
         AND snapshot_time <= now() - INTERVAL {downsample:UInt16} DAY
       GROUP BY toStartOfDay(snapshot_time)
       UNION ALL
       SELECT
         toString(snapshot_time)             AS t,
         toString(xrp_balance)               AS xrp_balance,
         toString(xrp_price_usd)             AS xrp_price_usd,
         toString(token_value_usd)           AS token_value_usd,
         toString(nft_count)                 AS nft_count,
         toString(amm_value_usd)             AS amm_value_usd,
         toString(locked_xrp)                AS locked_xrp,
         toString(total_value_usd)           AS total_value_usd,
         toString(owner_count)               AS owner_count
       FROM portfolio_snapshots
       WHERE address = {addr:String}
         AND snapshot_time > now() - INTERVAL {downsample:UInt16} DAY
     ) combined
     ORDER BY t ASC`,
    { addr: address, downsample: DOWNSAMPLE_RECENT_DAYS },
  );
}
