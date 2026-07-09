import { NextResponse, type NextRequest } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import {
  getCollectionItems,
  type CollectionItemSort,
  type CollectionItemFilter,
} from "@/lib/db-queries";
import { detectSearchType } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_SORTS = new Set<CollectionItemSort>([
  "recent_mint",
  "oldest_mint",
  "recently_acquired",
]);

const VALID_FILTERS = new Set<CollectionItemFilter>(["live", "burned", "all"]);

/**
 * Paginated items in a collection — powers the "Load more" + sort
 * controls on the collection detail page. Reads via getCollectionItems
 * which joins nft_static_metadata + nft_ownership and orders by the
 * caller-selected sort.
 */
export async function GET(
  request: NextRequest,
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

    const { searchParams } = request.nextUrl;
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 48) || 48, 1), 200);
    const offset = Math.max(Number(searchParams.get("offset") ?? 0) || 0, 0);
    const sortParam = (searchParams.get("sort") ?? "recent_mint") as CollectionItemSort;
    const sort: CollectionItemSort = VALID_SORTS.has(sortParam)
      ? sortParam
      : "recent_mint";
    const filterParam = (searchParams.get("filter") ?? "live") as CollectionItemFilter;
    const filter: CollectionItemFilter = VALID_FILTERS.has(filterParam)
      ? filterParam
      : "live";

    const items = await getCollectionItems(issuer, taxonNum, limit, offset, sort, filter);

    // Returning `hasMore` saves the client one round trip — we know
    // there's another page if we filled the requested limit.
    return cachedJson({ items, hasMore: items.length === limit }, 30);
  } catch (err) {
    logger.error({ err }, "[api/nft/collection/items] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
