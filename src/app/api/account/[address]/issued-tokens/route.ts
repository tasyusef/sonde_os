import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { xrplClient } from "@/lib/xrpl-client";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "api/account/issued-tokens" });

/**
 * Returns the tokens this account has issued, keyed by raw XRPL currency
 * code → outstanding obligation as a decimal string.
 *
 * Uses the server-side WS client with retry/backoff so heavy issuers
 * (thousands of trust lines, multi-second response times) don't time out
 * the way they do on the shared browser WS.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!XRPL_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const result = await xrplClient.getGatewayBalances(address);
    return cachedJson({ obligations: result.obligations ?? {} }, 60);
  } catch (err) {
    log.error({ err, address }, "gateway_balances fetch failed");
    return NextResponse.json({ obligations: {} }, { status: 200 });
  }
}
