import { NextResponse, type NextRequest } from "next/server";
import { refreshAccountTrustlines } from "@/lib/account-lines-refresh";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

const log = logger.child({ module: "api/trustlines-refresh" });

/** 5 refreshes per IP+address per minute. Account-page autoload fires
 *  once per visit; this lets a user reload a few times without hitting
 *  the limit but caps abusive hammering against rippled. */
const checkRateLimit = rateLimit("trustlines-refresh", 5);

export const dynamic = "force-dynamic";

/**
 * Live-refresh an account's CH trustline state from rippled
 * `account_lines`. Called by the client right after the instant CH
 * read so phantom holdings (CH rows for trustlines that have since
 * been closed on-ledger but whose DeletedNode event was missed by
 * the ingester) get reconciled.
 *
 * Returns immediately with a 204 if rate-limited or the refresh
 * succeeds — the response body isn't meaningful, the client just
 * needs to know it's safe to `mutate()` the CH SWR cache.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!XRPL_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(`${ip}:${address}`)) {
    // 429 with no body — client treats this as "data is as fresh as
    // we can make it right now" and continues using the CH read.
    return new NextResponse(null, { status: 429 });
  }

  try {
    const result = await refreshAccountTrustlines(address);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    log.error({ err, address }, "trustlines refresh failed");
    // 502 — rippled is the dependency that failed. Client falls back
    // to CH-only data, same as before.
    return NextResponse.json(
      { error: "Refresh failed" },
      { status: 502 },
    );
  }
}
