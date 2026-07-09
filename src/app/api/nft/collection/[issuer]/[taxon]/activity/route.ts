import { NextResponse, type NextRequest } from "next/server";
import { getCollectionActivity, getCollectionActivityPaginated } from "@/lib/db-queries";
import { detectSearchType } from "@/lib/xrpl-helpers";
import { cachedJson } from "@/lib/api-cache";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "api/nft-collection-activity" });

/**
 * Paginated collection trades — same shape as the portfolio
 * `/api/portfolio/activity` endpoint that
 * `src/components/portfolio/ActivityPanel` consumes:
 *
 *   GET /api/nft/collection/[issuer]/[taxon]/activity?before=<ts>&limit=15
 *
 * Returns `{ rows, nextBefore, hasMore }` where `nextBefore` is the
 * timestamp of the last row in the page — the client passes it back
 * as `before` to fetch the next page. This is a simple keyset
 * pagination on `timestamp DESC` since `nft_trades` is already
 * indexed by (timestamp, issuer, taxon).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ issuer: string; taxon: string }> },
) {
  const { issuer, taxon } = await params;
  const taxonNum = Number(taxon);
  if (
    detectSearchType(issuer) !== "account" ||
    !Number.isFinite(taxonNum) ||
    taxonNum < 0
  ) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const beforeParam = searchParams.get("before");
  const limitParam = searchParams.get("limit");
  const limit = Math.min(50, Math.max(1, Number(limitParam) || 15));
  const beforeUnix = beforeParam ? Number(beforeParam) : null;

  try {
    const rows =
      beforeUnix != null
        ? await getCollectionActivityPaginated(
            issuer,
            taxonNum,
            beforeUnix,
            limit,
          )
        : await getCollectionActivity(issuer, taxonNum, limit);

    // `hasMore` is true iff we filled the page — if fewer rows came
    // back, the table is exhausted at this filter. Same convention
    // the portfolio activity endpoint uses.
    const hasMore = rows.length === limit;
    const nextBefore =
      hasMore && rows.length > 0
        ? rows[rows.length - 1].date
        : null;

    return cachedJson({ rows, hasMore, nextBefore }, 30, 60);
  } catch (err) {
    log.error({ err, issuer, taxon: taxonNum }, "activity fetch failed");
    return NextResponse.json(
      { rows: [], hasMore: false, nextBefore: null },
      { status: 200 },
    );
  }
}
