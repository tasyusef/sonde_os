import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq, and, gte, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { getSubscription, MONTHLY_QUERY_LIMIT } from "@/lib/subscription";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import logger from "@/lib/logger";

const log = logger.child({ module: "api/subscription/status" });

/**
 * GET /api/subscription/status
 * Returns current tier, status, period, and AI usage for the authenticated user.
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const session = await getSession(cookieStore);
    if (!session) {
      return NextResponse.json({
        tier: "free",
        status: null,
        periodEnd: null,
        paymentMethod: null,
        cancelAtPeriodEnd: false,
        usage: { queriesUsed: 0, monthlyLimit: MONTHLY_QUERY_LIMIT },
      });
    }

    const sub = await getSubscription(session.address);

    // Count AI queries used this calendar month (for Pro users, including grace period)
    // Counts intel_query + portfolio_query (shared bucket). Investigations are a separate bucket.
    let queriesUsed = 0;
    if (sub.tier === "pro" && (sub.status === "active" || sub.status === "expired")) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(aiUsage)
        .where(
          and(
            eq(aiUsage.userAddress, session.address),
            gte(aiUsage.createdAt, monthStart),
            sql`${aiUsage.queryType} IN ('intel_query', 'portfolio_query')`,
          ),
        );
      queriesUsed = result[0]?.count ?? 0;
    }

    return NextResponse.json({
      tier: sub.tier,
      status: sub.status,
      periodEnd: sub.periodEnd?.toISOString() ?? null,
      paymentMethod: sub.paymentMethod,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      usage: { queriesUsed, monthlyLimit: MONTHLY_QUERY_LIMIT },
    });
  } catch (err) {
    log.error({ err }, "subscription status fetch failed");
    return NextResponse.json(
      { error: "Failed to fetch subscription status" },
      { status: 500 },
    );
  }
}
