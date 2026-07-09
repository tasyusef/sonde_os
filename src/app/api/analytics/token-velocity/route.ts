import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTokenVelocity } from "@/lib/analytics-queries";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_PERIODS = ["7d", "30d", "90d"] as const;
type Period = (typeof VALID_PERIODS)[number];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = (searchParams.get("period") ?? "7d") as Period;
    const limitParam = searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam) || 10, 1), 20);

    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json({ error: "Invalid period. Use 7d, 30d, or 90d." }, { status: 400 });
    }

    const tokens = await getTokenVelocity(period, limit);
    return cachedJson({ tokens }, 60);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/analytics/token-velocity] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
