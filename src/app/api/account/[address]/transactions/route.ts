import { NextResponse } from "next/server";
import { getMergedTxsForAccount, type AccountTxCursor } from "@/lib/clickhouse-queries";
import { resolveFromSearchParams } from "@/lib/account-tx-range";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import { cachedJson } from "@/lib/api-cache";

/**
 * Cursor-paginated transaction history for an account, served from
 * ClickHouse. Powers the "load more" path on the account page after the
 * server-rendered initial 50 txs.
 *
 * Calls `getMergedTxsForAccount` to match the page-1 SSR — both pages
 * get sender + receiver merged. An earlier version called the
 * sender-only `getTxsForAccount` here while the page used the merged
 * helper, which caused page 2+ to silently drop receiver-side rows
 * for accounts with mixed activity.
 *
 * Query params:
 *   - `before_ts` (string)  — cursor timestamp (CH `DateTime` literal)
 *   - `before_hash` (string) — cursor tx hash; together with `before_ts`
 *                              forms a strict-tuple cursor that CH compares
 *                              row-tuple to `(timestamp, tx_hash)`
 *   - `limit` (number)       — clamped to [1, 200], defaults to 50
 *   - `range` (string)       — relative chip key (`24h`/`7d`/`30d`/`90d`/
 *                              `1y`/`all`). Defaults to `30d` when missing.
 *   - `from`, `to` (YYYY-MM-DD) — custom date range; takes precedence over
 *                              `range` when both are valid. Inclusive UTC
 *                              day bounds.
 *
 * Returns: { items: AccountTxItem[], nextCursor, asOfLedger }
 *
 * Public endpoint — read-only, no auth required. CH is local; no public
 * rippled fan-out per request.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  // Validate address format up-front so an obviously bad URL doesn't
  // hit CH at all. CH would also reject it via the bound parameter, but
  // the early 400 is friendlier and faster.
  if (!XRPL_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid XRPL address" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  if (!Number.isFinite(limit) || limit < 1) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }

  const beforeTs = searchParams.get("before_ts");
  const beforeHash = searchParams.get("before_hash");
  let before: AccountTxCursor | undefined;
  if (beforeTs && beforeHash) {
    before = { timestamp: beforeTs, txHash: beforeHash };
  } else if (beforeTs || beforeHash) {
    return NextResponse.json(
      { error: "before_ts and before_hash must both be provided" },
      { status: 400 },
    );
  }

  // Resolve the date-range filter. Same vocabulary as the URL on the
  // account page — `range` chip key wins when there's no `from`/`to`,
  // and a valid `from`+`to` pair takes precedence when both are present.
  const { fromTs, toTs } = resolveFromSearchParams({
    range: searchParams.get("range"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });

  try {
    const result = await getMergedTxsForAccount(address, {
      limit,
      before,
      fromTs,
      toTs,
    });
    // Cursor-paginated pages (page 2+) are immutable — once you've
    // anchored on a (timestamp, tx_hash) tuple, the rows older than
    // that don't change. Cache aggressively at the CDN. Page 1
    // (no cursor) gets a short TTL so newly-indexed tx land quickly.
    if (before) {
      return cachedJson(result, 300, 600);
    }
    return cachedJson(result, 15, 60);
  } catch (err) {
    // CH outage shouldn't 500 here — return an empty page so the client
    // gracefully ends pagination. The first-page server render already
    // has its own fallback (rippled), so a degraded "no more history"
    // is a reasonable UX during a CH hiccup.
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { items: [], nextCursor: null, asOfLedger: null, error: message },
      { status: 200 },
    );
  }
}
