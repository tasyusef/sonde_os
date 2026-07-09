import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertHistory } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-alerts-poll", 60);

/** GET — poll unread alerts for authenticated user, mark as delivered */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const session = await getSession(await cookies());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch unread in-app alerts for this user's rules
  const unread = await db.execute<{
    id: number;
    rule_id: number;
    type: string;
    triggered_at: string;
    payload_json: unknown;
  }>(sql`
    SELECT ah.id, ah.rule_id, ar.type, ah.triggered_at, ah.payload_json
    FROM alert_history ah
    JOIN alert_rules ar ON ar.id = ah.rule_id
    WHERE ar.user_address = ${session.address}
      AND ah.delivery_channel = 'in_app'
      AND ah.read_at IS NULL
    ORDER BY ah.triggered_at DESC
    LIMIT 50
  `);

  // Mark as read
  if (unread.length > 0) {
    const ids = unread.map((r) => r.id);
    await db
      .update(alertHistory)
      .set({ readAt: new Date() })
      .where(inArray(alertHistory.id, ids));
  }

  return NextResponse.json({
    alerts: unread.map((r) => ({
      id: r.id,
      ruleId: r.rule_id,
      type: r.type,
      triggeredAt: r.triggered_at,
      payload: r.payload_json,
    })),
    count: unread.length,
  });
}
