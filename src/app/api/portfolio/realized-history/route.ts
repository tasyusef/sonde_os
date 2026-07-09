import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "@/lib/auth";
import logger from "@/lib/logger";

/**
 * GET /api/portfolio/realized-history
 * Returns cumulative realized PnL over time, grouped by day.
 */
export async function GET() {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await db.execute<{
      day: string;
      daily_pnl: string;
    }>(sql`
      SELECT
        DATE(realized_at) AS day,
        SUM(pnl_usd)::text AS daily_pnl
      FROM token_realized_pnl
      WHERE address = ${session.address}
      GROUP BY DATE(realized_at)
      ORDER BY day ASC
    `);

    // Build cumulative series
    let cumulative = 0;
    const points = rows.map((r) => {
      cumulative += parseFloat(r.daily_pnl);
      return {
        time: r.day,
        dailyPnl: parseFloat(r.daily_pnl),
        cumulativePnl: Math.round(cumulative * 100) / 100,
      };
    });

    return NextResponse.json({ points });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/portfolio/realized-history] Error");
    return NextResponse.json(
      { error: "Failed to fetch realized PnL history" },
      { status: 500 },
    );
  }
}
