import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { refreshAccountTrustlines } from "@/lib/account-lines-refresh";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import logger from "@/lib/logger";

const log = logger.child({ module: "api/portfolio-refresh" });

/** 5 refreshes per IP+address per minute. A normal page load fires
 *  once; the limit caps abusive hammering against rippled. */
const checkRateLimit = rateLimit("portfolio-refresh", 5);

export const dynamic = "force-dynamic";

/**
 * Live-reconcile the signed-in user's CH trustline state from rippled.
 * Called from the portfolio dashboard on mount so subsequent reads of
 * `/api/portfolio/tokens` (which live-computes from CH) reflect the
 * authoritative current ledger state.
 *
 * Only step is the trustline reconcile — `refreshAccountTrustlines`
 * heals CH `trustlines` against live `account_lines`, writing
 * `is_burned=1` for any phantom rows whose `DeletedNode` event the
 * ingester missed.
 *
 * Note: this used to also call `snapshotNow` to write a fresh
 * `portfolio_snapshots` row, but that's no longer needed — the
 * tokens endpoint stopped reading from snapshots when it switched to
 * live-compute. Snapshots are still written every 5 min by
 * `sonde-portfolio-snapshot.timer` for the over-time chart on
 * `/api/portfolio/history`, and once per sign-in by auth.ts. Removing
 * the redundant page-load snapshot saves ~0.5-2s on every portfolio
 * load.
 *
 * Returns 200 with `{ live, burned, pages }` from the reconcile so
 * the client can show a useful "Reconciled N holdings (M burned)"
 * message if it wants. 401 unauthenticated, 429 rate-limited, 502
 * rippled failed.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(`${ip}:${session.address}`)) {
    return new NextResponse(null, { status: 429 });
  }

  try {
    const result = await refreshAccountTrustlines(session.address);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    log.error({ err, address: session.address }, "portfolio refresh failed");
    return NextResponse.json({ error: "Refresh failed" }, { status: 502 });
  }
}
