import { NextRequest, NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getAMMListingForTable } from "@/lib/amm-data";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/amms/list?offset=0&limit=100
 *
 * Mirrors /api/tokens/list. Returns a single page of the AMM listing
 * sorted by TVL DESC. The data layer (`getAMMListingForTable`) caps
 * effective offset at AMM_LISTING_MAX (1000) and returns hasMore=false
 * past that, so "View More" naturally stops when the client hits the
 * ceiling.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10) || 100));

  try {
    const result = await getAMMListingForTable(offset, limit);
    return cachedJson(result, 120);
  } catch (err) {
    logger.error({ err }, "[api/amms/list] Error");
    return NextResponse.json(
      { error: "Failed to fetch AMM listing" },
      { status: 500 },
    );
  }
}
