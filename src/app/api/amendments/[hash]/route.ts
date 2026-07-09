import { NextResponse, type NextRequest } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import {
  getAmendmentInfo,
  getAmendmentVoteHistory,
} from "@/lib/amendment-queries";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["7d", "30d", "90d", "all"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  try {
    const { hash } = await params;

    if (!hash || hash.length !== 64 || !/^[0-9A-Fa-f]+$/.test(hash)) {
      return NextResponse.json(
        { error: "Invalid amendment hash. Must be 64-character hex." },
        { status: 400 },
      );
    }

    const { searchParams } = request.nextUrl;
    const period = searchParams.get("period") ?? "30d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json(
        { error: "Invalid period. Use 7d, 30d, 90d, or all." },
        { status: 400 },
      );
    }

    const [amendment, history] = await Promise.all([
      getAmendmentInfo(hash.toUpperCase()),
      getAmendmentVoteHistory(
        hash.toUpperCase(),
        period as "7d" | "30d" | "90d" | "all",
      ),
    ]);

    if (!amendment) {
      return NextResponse.json(
        { error: "Amendment not found" },
        { status: 404 },
      );
    }

    return cachedJson({ amendment, history }, 120);
  } catch (err) {
    logger.error({ err }, "[api/amendments/[hash]] Error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
