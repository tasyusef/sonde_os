import { NextResponse, type NextRequest } from "next/server";
import { query as chQuery } from "@/lib/clickhouse-client";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/api-cache";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("smart-money-history", 30);

/**
 * GET /api/smart-money/[address]/history
 *
 * Returns score history for trend chart. Pre-2026-05-01 only the #1
 * ranked wallet was free; gate retired in the Pro = AI only reshape.
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
    // score_history was migrated from PG → CH on 2026-04-28. ReplacingMergeTree
    // collapses duplicate (address, scored_at) tuples at merge time, but for
    // safety against same-second collisions we read with FINAL.
    // Alias the toString'd timestamp as `scored_at_str` (NOT `scored_at`) —
    // using the same name as the column makes CH bind ORDER BY to the
    // alias instead of the underlying DateTime64 column.
    const rows = await chQuery<{
      composite_score: number;
      scored_at_str: string;
    }>(
      `SELECT composite_score, toString(scored_at) AS scored_at_str
       FROM score_history FINAL
       WHERE address = {address:String}
       ORDER BY scored_at ASC
       LIMIT 90`,
      { address },
    );

    // Score history grows once per day from the daily scorer; all
    // viewers of a wallet detail page share the same trend payload.
    return cachedJson(
      {
        address,
        history: rows.map((r) => ({
          compositeScore: r.composite_score,
          scoredAt: r.scored_at_str,
        })),
      },
      300,
      900,
    );
  } catch (err) {
    logger.error({ err }, "[api/smart-money/history] Error");
    return NextResponse.json(
      { error: "Failed to fetch score history" },
      { status: 500 },
    );
  }
}
