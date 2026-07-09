import { NextResponse, type NextRequest } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTopNFTCollections } from "@/lib/nft-volumes";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "all"]);

/**
 * Top NFT collections by XRP volume. CH-backed via
 * `mv_nft_volume_hourly`. Enriched server-side with display name +
 * image URL pulled from PG `nft_metadata` (the cron's resolved
 * cache).
 *
 * Returns `NFTCollection[]` (name + issuer + imageUrl + volumeXrp
 * + sales) — the shape `NFTTopCollections` renders.
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
    const collections = await getTopNFTCollections(limit, helperPeriod);

    return cachedJson({ collections }, 60);
  } catch (err) {
    logger.error({ err }, "[api/rankings/nft-collections] Error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
