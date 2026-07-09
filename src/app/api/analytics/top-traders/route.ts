import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTopTraders } from "@/lib/analytics-queries";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_PERIODS = ["24h", "7d", "30d"] as const;
const VALID_MODES = ["volume", "profit"] as const;
type Period = (typeof VALID_PERIODS)[number];
type Mode = (typeof VALID_MODES)[number];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get("mode") ?? "volume") as Mode;
    const period = (searchParams.get("period") ?? "24h") as Period;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "10", 10) || 10, 20);

    if (!VALID_MODES.includes(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const traders = await getTopTraders(mode, period, limit);
    return cachedJson({ traders }, 60);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/analytics/top-traders] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
