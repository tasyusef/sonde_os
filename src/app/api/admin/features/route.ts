import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/admin-auth";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const weekAgo = new Date();
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);

  try {
    // `investigationsThisWeek` was removed alongside the Neo4j cut —
    // investigation_sessions table goes away in the same migration.
    const [alertRules, watchlistItems, smartMoneyViews] = await Promise.all([
      db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM alert_rules WHERE enabled = true
      `),
      db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM watchlist_items
      `),
      db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM page_views
        WHERE route_pattern = '/smart-money/[address]'
        AND timestamp >= ${weekAgo.toISOString()}
      `),
    ]);

    // Top route patterns this week
    const topRoutes = await db.execute<{ route_pattern: string; views: number }>(sql`
      SELECT route_pattern, count(*)::int AS views
      FROM page_views
      WHERE timestamp >= ${weekAgo.toISOString()}
      GROUP BY route_pattern
      ORDER BY views DESC
      LIMIT 10
    `);

    return NextResponse.json({
      activeAlertRules: alertRules[0]?.count ?? 0,
      totalWatchlistItems: watchlistItems[0]?.count ?? 0,
      smartMoneyViewsThisWeek: smartMoneyViews[0]?.count ?? 0,
      topRoutes,
    });
  } catch (err) {
    logger.error({ err }, "[admin/features]");
    return NextResponse.json({ error: "Failed to fetch feature usage" }, { status: 500 });
  }
}
