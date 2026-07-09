import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { verifyConnectivity as checkClickHouse } from "@/lib/clickhouse-client";
import { db } from "@/db";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession(await cookies());
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [clickhouse, postgres] = await Promise.all([
      checkClickHouse(),
      db.execute(sql`SELECT 1`)
        .then(() => true)
        .catch(() => false),
    ]);

    const allHealthy = clickhouse && postgres;

    return NextResponse.json(
      {
        status: allHealthy ? "healthy" : "degraded",
        stores: {
          clickhouse: clickhouse ? "connected" : "unreachable",
          postgres: postgres ? "connected" : "unreachable",
        },
        timestamp: new Date().toISOString(),
      },
      { status: allHealthy ? 200 : 503 },
    );
  } catch (err) {
    logger.error({ err }, "[api/intel/health] Error");
    return NextResponse.json(
      { status: "error", error: "Health check failed", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
