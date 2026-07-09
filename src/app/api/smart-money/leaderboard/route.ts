import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { smartMoneyScores } from "@/db/schema";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("smart-money-leaderboard", 30);

/**
 * GET /api/smart-money/leaderboard
 *
 * Full leaderboard, all columns. Pre-2026-05-01 the route was tiered
 * (free: top 25 limited columns; pro: full + pagination); the gate
 * was retired alongside the Neo4j removal as part of the Pro = AI
 * only reshape.
 *
 * Query params:
 *   ?limit=25&offset=0   — pagination (max 100)
 *   ?minScore=60          — minimum composite score
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = request.nextUrl;
  const limit = Math.min(Number(searchParams.get("limit")) || 25, 100);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);
  const minScore = Number(searchParams.get("minScore")) || 0;

  try {
    // Defensive `total_pnl_xrp > 0` gate at the read layer. The scorer
    // already filters to positive-PnL wallets at write time (see
    // `smart-money-scorer.ts` line ~667), but stale rows from before
    // the filter existed (or any future regression) shouldn't be able
    // to surface as "smart money" to users. 2026-05-05's pre-filter
    // run wrote 744 ≤0 rows that lived on the leaderboard for a week
    // before this gate was added — the cleanup DELETE handled those,
    // this gate prevents the same class of bug from recurring.
    const rows = await db
      .select({
        address: smartMoneyScores.address,
        compositeScore: smartMoneyScores.compositeScore,
        profitabilityScore: smartMoneyScores.profitabilityScore,
        roiScore: smartMoneyScores.roiScore,
        winRateScore: smartMoneyScores.winRateScore,
        consistencyScore: smartMoneyScores.consistencyScore,
        earlyBuyerScore: smartMoneyScores.earlyBuyerScore,
        smartExitScore: smartMoneyScores.smartExitScore,
        penalties: smartMoneyScores.penalties,
        totalPnlXrp: smartMoneyScores.totalPnlXrp,
        totalTrades: smartMoneyScores.totalTrades,
        winRate: smartMoneyScores.winRate,
        sharpeRatio: smartMoneyScores.sharpeRatio,
        tokensTraded: smartMoneyScores.tokensTraded,
        washTradingFlag: smartMoneyScores.washTradingFlag,
        scoredAt: smartMoneyScores.scoredAt,
      })
      .from(smartMoneyScores)
      .where(
        sql`${smartMoneyScores.compositeScore} >= ${minScore} AND ${smartMoneyScores.totalPnlXrp}::numeric > 0`,
      )
      .orderBy(sql`${smartMoneyScores.compositeScore} DESC`)
      .limit(limit)
      .offset(offset);

    // Total count for pagination — same PnL gate so paginated counts
    // match the visible rows.
    const countRows = await db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total
      FROM smart_money_scores
      WHERE composite_score >= ${minScore}
        AND total_pnl_xrp::numeric > 0
    `);
    const total = countRows[0]?.total ?? 0;

    // Smart money scorer runs daily at 00:46 UTC — leaderboard rows
    // don't change between runs. 5 min freshness keeps the CDN warm
    // without missing the daily reroll, swr=15min absorbs the hourly
    // load. Pagination params are part of the cache key automatically.
    return cachedJson({ leaderboard: rows, total, limit, offset }, 300, 900);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch leaderboard" },
      { status: 500 },
    );
  }
}
