import { NextResponse } from "next/server";
import { getTokensForPriceMap } from "@/lib/token-data";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

const log = logger.child({ module: "api/account/token-prices" });

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      pairs?: { currency: string; issuer: string }[];
    };

    const pairs = body?.pairs;
    if (!Array.isArray(pairs) || pairs.length === 0) {
      return NextResponse.json([]);
    }

    // Validate and cap to prevent abuse
    const capped = pairs
      .filter(
        (p): p is { currency: string; issuer: string } =>
          typeof p?.currency === "string" &&
          typeof p?.issuer === "string" &&
          p.currency.length <= 40 &&
          XRPL_ADDRESS_RE.test(p.issuer),
      )
      .slice(0, 200);
    const results = await getTokensForPriceMap(capped);
    return NextResponse.json(results);
  } catch (err) {
    log.error({ err }, "token-prices fetch failed");
    return NextResponse.json([], { status: 500 });
  }
}
