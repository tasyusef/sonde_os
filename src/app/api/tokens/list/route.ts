import { NextRequest, NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTokenListWithSupply } from "@/lib/token-data";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10) || 100));

  try {
    const result = await getTokenListWithSupply(offset, limit);
    return cachedJson(result, 120);
  } catch (err) {
    logger.error({ err }, "[api/tokens/list] Error");
    return NextResponse.json(
      { error: "Failed to fetch token list" },
      { status: 500 },
    );
  }
}
