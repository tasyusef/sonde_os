import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTopGainers24h, type MoverDirection } from "@/lib/top-tokens";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 10), 1), 25);
    const directionParam = searchParams.get("direction");
    const direction: MoverDirection =
      directionParam === "losers" ? "losers" : "gainers";

    // Response key stays "gainers" regardless of direction so existing
    // SWR-keyed consumers don't break — semantics is "top movers in
    // this direction" either way.
    const gainers = await getTopGainers24h(limit, direction);

    return cachedJson({ gainers }, 60);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/analytics/top-gainers] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
