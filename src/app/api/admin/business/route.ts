import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/admin-auth";
import { PRICING } from "@/lib/pricing";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    // Total registered users
    const [{ count: totalUsers }] = await db.execute<{ count: number }>(sql`
      SELECT count(DISTINCT address)::int AS count FROM tracked_accounts
    `);

    // Users by tier
    // Use DISTINCT on address + pick one subscription per user (if any) to avoid
    // inflating counts when a user has multiple active subscription rows.
    const tierBreakdown = await db.execute<{ tier: string; count: number }>(sql`
      SELECT tier, count(*)::int AS count FROM (
        SELECT t.address,
               COALESCE(
                 (SELECT s.tier FROM subscriptions s
                  WHERE s.user_address = t.address AND s.status = 'active'
                  ORDER BY s.updated_at DESC LIMIT 1),
                 'free'
               ) AS tier
        FROM tracked_accounts t
        GROUP BY t.address
      ) u
      GROUP BY tier
    `);

    // New signups (last 30 days, daily)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

    const signups = await db.execute<{ date: string; signups: number }>(sql`
      SELECT date_trunc('day', created_at)::date::text AS date, count(*)::int AS signups
      FROM tracked_accounts
      WHERE created_at >= ${thirtyDaysAgo.toISOString()}
      GROUP BY 1 ORDER BY 1
    `);

    // MRR calculation
    const activeSubs = await db.execute<{ tier: string; count: number }>(sql`
      SELECT tier, count(*)::int AS count FROM subscriptions WHERE status = 'active' GROUP BY tier
    `);

    let mrr = 0;
    for (const row of activeSubs) {
      // Legacy pro_ai rows are billed at the pro rate after the migration.
      if (row.tier === "pro" || row.tier === "pro_ai") {
        mrr += row.count * PRICING.pro.fiat.monthly;
      }
    }

    // Churn this month
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [{ count: churnThisMonth }] = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM subscriptions
      WHERE status = 'canceled' AND updated_at >= ${monthStart.toISOString()}
    `);

    // AI queries this month
    const [{ count: aiQueriesThisMonth }] = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM ai_usage
      WHERE created_at >= ${monthStart.toISOString()}
    `);

    return NextResponse.json({
      totalUsers,
      tierBreakdown,
      signups,
      mrr,
      activeSubs,
      churnThisMonth,
      aiQueriesThisMonth,
    });
  } catch (err) {
    logger.error({ err }, "[admin/business]");
    return NextResponse.json({ error: "Failed to fetch business metrics" }, { status: 500 });
  }
}
