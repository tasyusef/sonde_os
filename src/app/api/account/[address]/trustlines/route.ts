import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getAccountTrustLines } from "@/lib/clickhouse-queries";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "api/account/trustlines" });

/**
 * Returns the account's current trustlines, served from the CH
 * `trustlines` state mirror. Replaces the rippled `account_objects`
 * paginate-all loop the client previously walked through `useAccountObjects`.
 *
 * Performance shape:
 *   - Old: N pages of `account_objects` (250 per page), 5–10 serial WS
 *     round-trips for whale accounts (Sologenic-class with 10k+ trustlines
 *     hit the page cap of 50 = 12,500 row max). Cold-load was 2–10s.
 *   - New: single CH query, partition prune + range scan on the leading
 *     PK column. Sub-100ms regardless of trustline count, no cap.
 *
 * Response is shaped to match the existing rippled-shape consumer
 * interface (`TrustLine[]` from `@/components/account/TrustLineList`)
 * with the queried account always emitted as the LowLimit side. This
 * means existing perspective math (`isHigh = HighLimit.issuer === address`)
 * resolves to `false` on every row and reads `Balance.value` as-is —
 * the same value our CH `balance_value` column holds (signed from the
 * account's perspective). No consumer-side flip required.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!XRPL_ADDRESS_RE.test(address)) {
    return NextResponse.json(
      { error: "Invalid XRPL address" },
      { status: 400 },
    );
  }

  try {
    const trustLines = await getAccountTrustLines(address);
    // Short cache: the client also fires a parallel /refresh that
    // updates CH from live XRPL state on every page load, then SWR
    // revalidates this endpoint. A 5-min CDN cache here would just
    // hide fresh writes for up to 5 min. Keep it tight (15s + 60s SWR)
    // so revalidation actually picks up the refreshed rows.
    return cachedJson(
      {
        trustLines,
        count: trustLines.length,
      },
      15,
      60,
    );
  } catch (err) {
    log.error({ err, address }, "trustlines fetch failed");
    return NextResponse.json(
      {
        trustLines: [],
        count: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 200 },
    );
  }
}
