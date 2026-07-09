import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getNetworkGrowthStats } from "@/lib/analytics-queries";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_PERIODS = ["7d", "30d", "90d"] as const;
type Period = (typeof VALID_PERIODS)[number];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = (searchParams.get("period") ?? "7d") as Period;

    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json({ error: "Invalid period. Use 7d, 30d, or 90d." }, { status: 400 });
    }

    const result = await getNetworkGrowthStats(period);
    return cachedJson(result, 60);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/analytics/network-growth] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
