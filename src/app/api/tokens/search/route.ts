import { NextRequest, NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { searchTokens } from "@/lib/token-data";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Full-table token search by ticker, name, issuer name, or issuer address.
 * Used by the markets page filter when local results (the loaded leaderboard
 * pages) come up empty — so tokens past page 0 are still findable by typing
 * their ticker.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20));

  if (q.length === 0) {
    return cachedJson({ tokens: [] }, 60);
  }

  try {
    const tokens = await searchTokens(q, limit);
    return cachedJson({ tokens }, 60);
  } catch (err) {
    logger.error({ err, q }, "[api/tokens/search] Error");
    return NextResponse.json(
      { error: "Failed to search tokens" },
      { status: 500 },
    );
  }
}
