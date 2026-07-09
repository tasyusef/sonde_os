import { NextResponse } from "next/server";
import { query } from "@/lib/clickhouse-client";
import { XRPL_EPOCH } from "@/lib/xrpl-helpers";

export const dynamic = "force-dynamic";

/**
 * Returns the most recent ledgers shaped like the SSE LedgerEvent for
 * seeding the heatmap on `/network`. Sourced from CH `ledger_metadata`
 * (the full historical record written by the live ingester) so the
 * heatmap is fully populated on first paint.
 *
 * Previously this read from PG `recent_ledgers`, a 201-entry ring buffer
 * that the Railway-hosted LiveDataManager populated only forward from
 * its startup time. Result: every Railway redeploy reset the visible
 * heatmap to ~0 cells and it took ~17 minutes (201 × 5s ledger close)
 * to refill. Now CH gives us the full 201 immediately and the live SSE
 * pipeline shifts new ledgers in / oldest out as they arrive.
 *
 * The `MAX_CELLS = 200` cap on the consumer side means we want ~201
 * raw ledgers (200 inter-ledger close-time intervals).
 *
 * **Time format note.** The SSE pipeline sends `ledger_time` in XRPL
 * ripple time (seconds since 2000-01-01). The CH `close_time` column
 * is a DateTime, which `toUnixTimestamp` converts to Unix epoch seconds
 * (since 1970-01-01). We subtract `XRPL_EPOCH` (946,684,800) to align
 * with what SSE emits — otherwise the merge function in the consumer
 * computes a ~30-year delta at the boundary between API-seeded and
 * SSE-streamed ledgers, blowing up the average close time and the TPS
 * calculation for the boundary cells.
 */

const HEATMAP_BUFFER = 201;

interface LedgerMetadataRow extends Record<string, unknown> {
  ledger_index: number;
  ledger_time: number;
  tx_count: number;
}

export async function GET() {
  try {
    // Newest-first then reverse to ascending — keeps `LIMIT` small without
    // sorting the entire table client-side. close_time → ripple seconds
    // (subtract XRPL_EPOCH) so the consumer's per-ledger delta math
    // (curr.ledger_time - prev.ledger_time) lines up with the SSE format.
    const rows = await query<LedgerMetadataRow>(`
      SELECT
        ledger_index,
        toUnixTimestamp(close_time) - ${XRPL_EPOCH} AS ledger_time,
        tx_count
      FROM sonde.ledger_metadata
      ORDER BY ledger_index DESC
      LIMIT ${HEATMAP_BUFFER}
    `);

    const ledgers = rows
      .reverse()
      .map((r) => ({
        ledger_index: Number(r.ledger_index),
        ledger_hash: "",
        ledger_time: Number(r.ledger_time),
        txn_count: Number(r.tx_count),
      }));

    // The SSE stream owns the live edge — this endpoint just seeds
    // the heatmap on cold load. Bumped from s-maxage=5/swr=10 because
    // the consumer doesn't depend on this for freshness.
    return NextResponse.json(ledgers, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  } catch {
    // CH unreachable — return empty so the UI gracefully degrades to
    // showing only live-SSE-collected ledgers (the pre-fix behavior).
    return NextResponse.json([], { status: 200 });
  }
}
