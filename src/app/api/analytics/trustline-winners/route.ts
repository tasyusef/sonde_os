import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTrustlineWinners } from "@/lib/top-tokens";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 10), 1), 25);

    // Last ~24-48h window. Day-granular MV — using 2 days (yesterday +
    // today) guards against today's partition not being fully aggregated
    // yet early in the day. net_new > 3 threshold is lower than the 7d
    // marketing card since daily churn is naturally smaller.
    const tokens = await getTrustlineWinners(2, 3, limit);

    return cachedJson({ tokens }, 60);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/analytics/trustline-winners] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
