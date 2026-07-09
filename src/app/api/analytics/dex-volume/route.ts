import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getDexVolumeTimeSeries, getDexVolumeTotal, VALID_PERIODS, type Period } from "@/lib/analytics-queries";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = (searchParams.get("period") ?? "7d") as Period;

    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const [timeSeries, total] = await Promise.all([
      getDexVolumeTimeSeries(period),
      getDexVolumeTotal(period),
    ]);

    return cachedJson({ timeSeries, total }, 30);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/analytics/dex-volume] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
