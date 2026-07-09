import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getPaymentCorridors, getCorridorStats } from "@/lib/analytics-queries";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_PERIODS = ["24h", "7d", "30d"] as const;
type Period = (typeof VALID_PERIODS)[number];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = (searchParams.get("period") ?? "7d") as Period;
    const limit = Math.min(30, Math.max(1, parseInt(searchParams.get("limit") ?? "15", 10) || 15));

    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const [corridors, stats] = await Promise.all([
      getPaymentCorridors(period, limit),
      getCorridorStats(period),
    ]);

    return cachedJson({ corridors, stats }, 30);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/analytics/corridors] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
