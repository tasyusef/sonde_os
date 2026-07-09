import { NextResponse, type NextRequest } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getAmendments, getAmendmentSummary } from "@/lib/amendment-queries";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_FILTERS = new Set(["pending", "majority", "enabled", "all"]);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filter = searchParams.get("filter") ?? "all";

    if (!VALID_FILTERS.has(filter)) {
      return NextResponse.json(
        { error: "Invalid filter. Use pending, majority, enabled, or all." },
        { status: 400 },
      );
    }

    const [amendmentsList, summary] = await Promise.all([
      getAmendments(filter as "pending" | "majority" | "enabled" | "all"),
      getAmendmentSummary(),
    ]);

    return cachedJson({ amendments: amendmentsList, summary }, 120);
  } catch (err) {
    logger.error({ err }, "[api/amendments] Error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
