import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import { getAccountTxCounts } from "@/lib/clickhouse-queries";
import { getChTransactionBounds } from "@/lib/ch-bounds";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "api/account/counts" });

/**
 * Returns lifetime per-account transaction counters. Served from the
 * `account_tx_counts` AggregatingMergeTree in ClickHouse (Phase 2 of
 * the PG → CH migration, 2026-05-09).
 *
 * The table was bootstrapped from a PG snapshot capturing pre-CH-retention
 * activity (the live ingester started writing PG before CH `transactions`
 * had retention coverage), then continues forward via two materialized
 * views: one from `transactions` (sender side) and one from
 * `value_transfer_events` (receiver side). PK lookup on `account` —
 * sub-millisecond regardless of total table size.
 *
 * Response shape:
 *   { sentCount, receivedCount, totalCount, firstSeenLedger, lastSeenLedger,
 *     indexMinLedger, indexMinTimestamp }
 *
 * If the account has never been seen in our index, returns zeros.
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
    const [counts, chBounds] = await Promise.all([
      getAccountTxCounts(address),
      // ch-bounds is cached in-process for 1h, so most calls return instantly.
      // Returning null on CH hiccups is fine — the client just skips the
      // "older history not indexed" hint.
      getChTransactionBounds(),
    ]);

    const sentCount = counts?.sentCount ?? 0;
    const receivedCount = counts?.receivedCount ?? 0;

    return cachedJson(
      {
        sentCount,
        receivedCount,
        totalCount: sentCount + receivedCount,
        firstSeenLedger: counts?.firstSeenLedger ?? null,
        lastSeenLedger: counts?.lastSeenLedger ?? null,
        /** Earliest ledger present in CH's transactions table — anything
         *  with `firstSeenLedger < indexMinLedger` has unindexed history. */
        indexMinLedger: chBounds?.minLedger ?? null,
        /** Earliest timestamp present in CH's transactions table —
         *  surfaced so the UI can render a human-readable cutoff like
         *  "May 2025" without round-tripping a separate endpoint. */
        indexMinTimestamp: chBounds?.minTimestamp ?? null,
      },
      30,
    );
  } catch (err) {
    log.error({ err, address }, "account counts query failed");
    return NextResponse.json(
      {
        sentCount: 0,
        receivedCount: 0,
        totalCount: 0,
        firstSeenLedger: null,
        lastSeenLedger: null,
        indexMinLedger: null,
        indexMinTimestamp: null,
      },
      { status: 200 },
    );
  }
}
