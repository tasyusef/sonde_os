import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/admin-auth";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = request.nextUrl;
  const days = Math.min(Number(searchParams.get("days")) || 30, 90);
  const routePattern = searchParams.get("route") ?? null;

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  try {
    // Daily page views
    const dailyViews = await db.execute<{
      date: string;
      views: number;
      uniques: number;
    }>(sql`
      SELECT
        date_trunc('day', timestamp)::date::text AS date,
        count(*)::int AS views,
        count(DISTINCT visitor_hash)::int AS uniques
      FROM page_views
      WHERE timestamp >= ${cutoff.toISOString()}
      ${routePattern ? sql`AND route_pattern = ${routePattern}` : sql``}
      GROUP BY 1 ORDER BY 1
    `);

    // Top pages (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

    const topPages = await db.execute<{
      route_pattern: string;
      views: number;
    }>(sql`
      SELECT route_pattern, count(*)::int AS views
      FROM page_views
      WHERE timestamp >= ${sevenDaysAgo.toISOString()}
      GROUP BY route_pattern
      ORDER BY views DESC
      LIMIT 15
    `);

    // Top referrers (last 7 days). Excludes nulls (direct + internal).
    // Uniques are distinct visitor hashes per host — the more useful
    // metric than raw views for "where did the wave of new users come
    // from."
    const topReferrers = await db.execute<{
      referrer_host: string;
      views: number;
      uniques: number;
    }>(sql`
      SELECT
        referrer_host,
        count(*)::int AS views,
        count(DISTINCT visitor_hash)::int AS uniques
      FROM page_views
      WHERE timestamp >= ${sevenDaysAgo.toISOString()}
        AND referrer_host IS NOT NULL
      GROUP BY referrer_host
      ORDER BY uniques DESC
      LIMIT 15
    `);

    // Today's stats
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const todayStats = await db.execute<{ views: number; uniques: number }>(sql`
      SELECT count(*)::int AS views, count(DISTINCT visitor_hash)::int AS uniques
      FROM page_views WHERE timestamp >= ${today.toISOString()}
    `);

    const yesterdayStats = await db.execute<{ views: number; uniques: number }>(sql`
      SELECT count(*)::int AS views, count(DISTINCT visitor_hash)::int AS uniques
      FROM page_views WHERE timestamp >= ${yesterday.toISOString()} AND timestamp < ${today.toISOString()}
    `);

    // All-time route patterns for the dropdown
    const routePatterns = await db.execute<{ route_pattern: string }>(sql`
      SELECT DISTINCT route_pattern FROM page_views ORDER BY route_pattern
    `);

    return NextResponse.json({
      dailyViews,
      topPages,
      topReferrers,
      today: todayStats[0] ?? { views: 0, uniques: 0 },
      yesterday: yesterdayStats[0] ?? { views: 0, uniques: 0 },
      routePatterns: routePatterns.map((r) => r.route_pattern),
    });
  } catch (err) {
    logger.error({ err }, "[admin/analytics]");
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}
