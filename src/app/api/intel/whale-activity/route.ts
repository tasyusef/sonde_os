import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/api-cache";
import { getWhaleActivity } from "@/lib/whale-activity";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-whale-activity", 30);

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = request.nextUrl;
  const currency = searchParams.get("currency");
  const issuer = searchParams.get("issuer");
  const period = searchParams.get("period") ?? "7d";

  if (!currency || !issuer || !XRPL_ADDRESS_RE.test(issuer)) {
    return NextResponse.json({ error: "currency and valid issuer required" }, { status: 400 });
  }

  if (!["24h", "7d", "30d"].includes(period)) {
    return NextResponse.json({ error: "period must be 24h, 7d, or 30d" }, { status: 400 });
  }

  try {
    const result = await getWhaleActivity(currency, issuer, period);
    // Result keyed by (currency, issuer, period) — identical for every
    // viewer of a given token page. The in-memory whaleCache is per-
    // process and Railway recycles often; CDN cache outlives recycles.
    return cachedJson(result, 60, 300);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch whale activity" },
      { status: 500 },
    );
  }
}
