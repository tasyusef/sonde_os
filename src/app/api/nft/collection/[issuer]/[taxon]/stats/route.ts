import { NextResponse, type NextRequest } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import {
  getCollectionStats,
  getCollectionVolumeSplits,
} from "@/lib/db-queries";
import { detectSearchType } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Collection-page stats endpoint. Returns the static counts + floor
 * AND all four volume splits in one payload so the period toggle on
 * the client can switch instantly without a re-fetch.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ issuer: string; taxon: string }> },
) {
  try {
    const { issuer, taxon } = await params;
    if (detectSearchType(issuer) !== "account") {
      return NextResponse.json({ error: "Invalid issuer address" }, { status: 400 });
    }
    const taxonNum = Number(taxon);
    if (!Number.isFinite(taxonNum) || taxonNum < 0) {
      return NextResponse.json({ error: "Invalid taxon" }, { status: 400 });
    }

    // Two independent CH queries — run in parallel.
    const [base, splits] = await Promise.all([
      getCollectionStats(issuer, taxonNum),
      getCollectionVolumeSplits(issuer, taxonNum),
    ]);

    return cachedJson(
      {
        stats: {
          itemCount: base.itemCount,
          liveCount: base.liveCount,
          holderCount: base.holderCount,
          floorDrops: base.floorDrops,
          volumes: {
            h24Drops: splits.volume24hDrops,
            d7Drops: splits.volume7dDrops,
            d30Drops: splits.volume30dDrops,
            allDrops: splits.volumeAllDrops,
            h24Trades: splits.trades24h,
            d7Trades: splits.trades7d,
            d30Trades: splits.trades30d,
            allTrades: splits.tradesAll,
          },
        },
      },
      60,
    );
  } catch (err) {
    logger.error({ err }, "[api/nft/collection/stats] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
