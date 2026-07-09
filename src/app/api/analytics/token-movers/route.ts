import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTopTokenMovers } from "@/lib/analytics-queries";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_PERIODS = ["24h", "7d", "30d"] as const;
type Period = (typeof VALID_PERIODS)[number];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = (searchParams.get("period") ?? "24h") as Period;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "8", 10) || 8, 20);

    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const movers = await getTopTokenMovers(period, limit);
    return cachedJson({ movers }, 60);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/analytics/token-movers] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
