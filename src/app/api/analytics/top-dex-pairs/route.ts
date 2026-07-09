import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTopDexPairs } from "@/lib/top-tokens";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 10), 1), 25);

    // Last ~24-48h window. Day-granular MV where today's partition may
    // not be fully aggregated yet, so a windowDays=1 query often returns
    // 0 rows early in the day. Using 2 gives us yesterday + today and
    // stays current.
    const pairs = await getTopDexPairs(2, limit);

    return cachedJson({ pairs }, 60);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/analytics/top-dex-pairs] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
