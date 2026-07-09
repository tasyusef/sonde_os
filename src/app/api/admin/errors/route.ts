import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/admin-auth";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const dayAgo = new Date();
  dayAgo.setUTCDate(dayAgo.getUTCDate() - 1);

  const twoDaysAgo = new Date();
  twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);

  try {
    const [recentErrors, todayCount, yesterdayCount, failedAlerts] = await Promise.all([
      // Recent errors (last 24h)
      db.execute<{
        id: number;
        route: string;
        error_message: string;
        timestamp: string;
      }>(sql`
        SELECT id, route, error_message, timestamp::text
        FROM api_errors
        WHERE timestamp >= ${dayAgo.toISOString()}
        ORDER BY timestamp DESC
        LIMIT 50
      `),

      // Error count today
      db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM api_errors
        WHERE timestamp >= ${new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()}
      `),

      // Error count yesterday
      db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM api_errors
        WHERE timestamp >= ${twoDaysAgo.toISOString()}
        AND timestamp < ${dayAgo.toISOString()}
      `),

      // Failed alert deliveries
      db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM alert_history
        WHERE delivery_status = 'failed'
        AND triggered_at >= ${dayAgo.toISOString()}
      `),
    ]);

    return NextResponse.json({
      recentErrors,
      errorsToday: todayCount[0]?.count ?? 0,
      errorsYesterday: yesterdayCount[0]?.count ?? 0,
      failedAlerts: failedAlerts[0]?.count ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "[admin/errors]");
    return NextResponse.json({ error: "Failed to fetch errors" }, { status: 500 });
  }
}
