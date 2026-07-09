import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/api-cache";
import { getIssuerAnalysis } from "@/lib/issuer-analysis";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-issuer-analysis", 30);

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = request.nextUrl;
  const currency = searchParams.get("currency");
  const issuer = searchParams.get("issuer");

  if (!currency || !issuer || !XRPL_ADDRESS_RE.test(issuer)) {
    return NextResponse.json({ error: "currency and valid issuer required" }, { status: 400 });
  }

  try {
    const result = await getIssuerAnalysis(currency, issuer);
    // Result identical per (currency, issuer) — every viewer of a
    // token page shares the same payload. 1 min freshness window.
    return cachedJson(result, 60, 300);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to analyze issuer distribution" },
      { status: 500 },
    );
  }
}
