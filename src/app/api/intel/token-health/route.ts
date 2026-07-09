import { NextResponse, type NextRequest } from "next/server";
import { computeTokenHealth } from "@/lib/token-health";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/api-cache";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("token-health", 60);
const log = logger.child({ module: "api/intel/token-health" });

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  const { searchParams } = request.nextUrl;
  const currency = searchParams.get("currency");
  const issuer = searchParams.get("issuer");

  if (!currency || currency.length > 40) {
    return NextResponse.json({ error: "Valid currency required (max 40 chars)" }, { status: 400 });
  }

  if (!issuer || !XRPL_ADDRESS_RE.test(issuer)) {
    return NextResponse.json({ error: "Valid issuer address required" }, { status: 400 });
  }

  try {
    const result = await computeTokenHealth(currency, issuer);
    // computeTokenHealth fans out across multiple CH/PG round-trips;
    // result is keyed only by (currency, issuer) so all viewers share.
    return cachedJson(result, 120, 600);
  } catch (err) {
    log.error({ err, currency, issuer }, "token health computation failed");
    return NextResponse.json(
      { error: "Failed to compute token health" },
      { status: 500 },
    );
  }
}
