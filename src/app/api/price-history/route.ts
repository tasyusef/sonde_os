import { NextRequest, NextResponse } from "next/server";
import { getXrpPriceHistory } from "@/lib/price-data";
import { cachedJson } from "@/lib/api-cache";
import logger from "@/lib/logger";

const ALLOWED_DAYS = new Set([1, 5, 30, 90, 180, 365, 1825]);
const ALLOWED_TSYMS = new Set(["USD", "EUR", "GBP", "BTC", "ETH"]);

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("days") ?? "30";
  const rawTsym = req.nextUrl.searchParams.get("tsym") ?? "USD";
  const tsym = ALLOWED_TSYMS.has(rawTsym) ? rawTsym : "USD";

  let days: number | "max";
  if (raw === "max") {
    days = "max";
  } else {
    const parsed = parseInt(raw, 10);
    // Allow exact matches or YTD (1-366)
    days = ALLOWED_DAYS.has(parsed) || (parsed >= 1 && parsed <= 366) ? parsed : 30;
  }

  try {
    const history = await getXrpPriceHistory(days, tsym);
    // Granularity-tiered TTL — minute candles for 1-day windows go
    // stale fast, daily candles barely change. The in-memory cache
    // in price-data.ts already does this, but the CDN layer can also
    // serve repeat hits without ever reaching the Next runtime.
    const maxAge = days === 1 ? 60 : days === "max" || (typeof days === "number" && days >= 90) ? 1800 : 600;
    return cachedJson(history, maxAge);
  } catch (err) {
    logger.error({ err }, "[price-history] Failed to fetch");
    return NextResponse.json([], { status: 500 });
  }
}
