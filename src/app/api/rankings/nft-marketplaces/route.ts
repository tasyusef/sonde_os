import { NextResponse, type NextRequest } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTopNFTMarketplaces } from "@/lib/nft-volumes";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

// Tracks the periods the underlying helper accepts. The helper takes
// "day" | "all"; we expose more user-facing options via the rankings
// route by passing through the strictly-valid pair only. Other periods
// fall back to "day" to keep the API forward-compatible.
const VALID_PERIODS = new Set(["24h", "7d", "30d", "all"]);

/**
 * Top NFT marketplaces by XRP volume. CH-backed via
 * `mv_nft_volume_hourly`. Enriched with favicon URLs server-side.
 *
 * Returns `NFTMarketplace[]` (name + logoUrl + volumeXrp + sales)
 * — the shape the `NFTTopMarketplaces` component renders. The
 * rankings table data and the favicon enrichment used to live in
 * the page-level fetcher (`NetworkRankingsLoader.BottomRankingsLoader`)
 * with both periods pre-fetched eagerly. Now self-fetching via this
 * route on period change.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const period = searchParams.get("period") ?? "24h";
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 10) || 10, 1), 100);

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json(
        { error: "Invalid period. Use 24h, 7d, 30d, or all." },
        { status: 400 },
      );
    }

    const helperPeriod = period === "all" ? "all" : "day";
    const marketplaces = await getTopNFTMarketplaces(limit, helperPeriod);

    return cachedJson({ marketplaces }, 60);
  } catch (err) {
    logger.error({ err }, "[api/rankings/nft-marketplaces] Error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
