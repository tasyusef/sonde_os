import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import "@/db/schema";
import { getSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-alerts-history", 30);

/** GET — paginated alert history for authenticated user */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const session = await getSession(await cookies());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 50, 100);
  const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);

  const rows = await db.execute<{
    id: number;
    rule_id: number;
    type: string;
    triggered_at: string;
    payload_json: unknown;
    delivery_status: string;
    delivery_channel: string;
    read_at: string | null;
  }>(sql`
    SELECT ah.id, ah.rule_id, ar.type, ah.triggered_at, ah.payload_json,
           ah.delivery_status, ah.delivery_channel, ah.read_at
    FROM alert_history ah
    JOIN alert_rules ar ON ar.id = ah.rule_id
    WHERE ar.user_address = ${session.address}
    ORDER BY ah.triggered_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return NextResponse.json({
    alerts: rows.map((r) => ({
      id: r.id,
      ruleId: r.rule_id,
      type: r.type,
      triggeredAt: r.triggered_at,
      payload: r.payload_json,
      status: r.delivery_status,
      channel: r.delivery_channel,
      readAt: r.read_at,
    })),
  });
}
