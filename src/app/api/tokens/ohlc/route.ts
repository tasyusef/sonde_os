import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getTokenOHLC } from "@/lib/token-ohlc-queries";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_PERIODS = ["7d", "30d", "90d", "all"] as const;
type Period = (typeof VALID_PERIODS)[number];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const currency = searchParams.get("currency");
    const issuer = searchParams.get("issuer");
    const period = (searchParams.get("period") ?? "7d") as Period;

    if (!currency || !issuer || currency.length > 40 || !XRPL_ADDRESS_RE.test(issuer)) {
      return NextResponse.json({ error: "currency and issuer are required" }, { status: 400 });
    }

    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const data = await getTokenOHLC(currency, issuer, period);

    return cachedJson({ data }, 60);
  } catch (err) {
    logger.error({ err }, "[api/tokens/ohlc] Error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
