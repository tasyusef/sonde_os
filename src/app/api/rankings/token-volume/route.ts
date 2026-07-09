import { NextResponse, type NextRequest } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTokenVolumeRankings } from "@/lib/db-queries";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "all"]);
const VALID_PAIR_FILTERS = new Set(["xrp", "all"]);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const period = searchParams.get("period") ?? "24h";
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20) || 20, 1), 100);
    const pair = searchParams.get("pair") ?? "xrp";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json(
        { error: "Invalid period. Use 24h, 7d, 30d, or all." },
        { status: 400 },
      );
    }

    if (!VALID_PAIR_FILTERS.has(pair)) {
      return NextResponse.json(
        { error: "Invalid pair filter. Use xrp or all." },
        { status: 400 },
      );
    }

    const data = await getTokenVolumeRankings(
      period as "24h" | "7d" | "30d" | "all",
      limit,
      pair as "xrp" | "all",
    );

    return cachedJson(data, 60);
  } catch (err) {
    logger.error({ err }, "[api/rankings/token-volume] Error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
