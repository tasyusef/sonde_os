import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/api-cache";
import { getSmartMoneyDetail } from "@/lib/smart-money-data";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("smart-money-detail", 30);

/**
 * GET /api/smart-money/[address]
 *
 * Returns full score breakdown for a single wallet. The drizzle query
 * lives in `@/lib/smart-money-data` so the smart-money detail page's
 * server component can pre-fetch the same shape and pass it as
 * SWR `fallbackData` for a TTFB-rendered score gauge.
 *
 * Pre-2026-05-01 the route only allowed the #1 ranked wallet for free
 * users; the tier gate was retired in the Pro = AI only reshape.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { address } = await params;
  if (!XRPL_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid XRPL address" }, { status: 400 });
  }

  try {
    const detail = await getSmartMoneyDetail(address);
    if (!detail) {
      return NextResponse.json({ error: "Wallet not scored" }, { status: 404 });
    }
    // Per-wallet score detail — refreshed by the daily smart-money
    // scorer at 00:46 UTC. 5 min freshness window matches leaderboard.
    return cachedJson(detail, 300, 900);
  } catch (err) {
    logger.error({ err }, "[api/smart-money] Error");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch wallet score" },
      { status: 500 },
    );
  }
}
