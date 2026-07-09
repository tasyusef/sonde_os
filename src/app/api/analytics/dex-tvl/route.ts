import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getDexTVL } from "@/lib/amm-data";
import { getXrpPrice } from "@/lib/price-data";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const priceData = await getXrpPrice();
    const xrpPrice = priceData?.price ?? 0;
    const tvl = await getDexTVL(xrpPrice);

    if (!tvl) {
      return NextResponse.json({ error: "No AMM pool data available" }, { status: 404 });
    }

    return cachedJson(tvl, 60);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/analytics/dex-tvl] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
