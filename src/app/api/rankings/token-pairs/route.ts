import { NextResponse, type NextRequest } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTopTradedPairs } from "@/lib/db-queries";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["24h", "7d", "30d"]);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const period = searchParams.get("period") ?? "24h";
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20) || 20, 1), 100);

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json(
        { error: "Invalid period. Use 24h, 7d, or 30d." },
        { status: 400 },
      );
    }

    const data = await getTopTradedPairs(
      period as "24h" | "7d" | "30d",
      limit,
    );

    return cachedJson(data, 60);
  } catch (err) {
    logger.error({ err }, "[api/rankings/token-pairs] Error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
