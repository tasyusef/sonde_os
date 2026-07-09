import { NextRequest, NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getHolderData } from "@/lib/holder-queries";
import logger from "@/lib/logger";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const currency = searchParams.get("currency");
  const issuer = searchParams.get("issuer");
  const period = searchParams.get("period") ?? "30d";

  const validPeriods = ["7d", "30d", "90d", "all"] as const;
  if (!validPeriods.includes(period as typeof validPeriods[number])) {
    return NextResponse.json(
      { error: "Invalid period. Must be one of: " + validPeriods.join(", ") },
      { status: 400 },
    );
  }

  if (!currency || !issuer || currency.length > 40 || !/^r[1-9A-HJ-NP-Za-km-z]{24,33}$/.test(issuer)) {
    return NextResponse.json(
      { error: "currency and issuer are required" },
      { status: 400 },
    );
  }

  try {
    const data = await getHolderData(currency, issuer, period as "7d" | "30d" | "90d" | "all");
    return cachedJson(data, 60);
  } catch (err) {
    logger.error({ err }, "[api/tokens/holders] Error");
    return NextResponse.json(
      { error: "Failed to fetch holder data" },
      { status: 500 },
    );
  }
}
