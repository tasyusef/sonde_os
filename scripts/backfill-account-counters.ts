/**
 * Backfill account_tx_counts from ClickHouse transactions.
 *
 * One-shot script — run after `create_account_tx_counts` migration has been
 * applied. Aggregates sent/received totals from everything currently in
 * ClickHouse `transactions` and bulk-upserts into Postgres.
 *
 * Safe to re-run: the upsert is idempotent (REPLACEs counts rather than
 * adding), so re-running resyncs the table to CH's current state. Use for
 * reconciliation if the live ingestion's incremental upserts drift.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-account-counters.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { createClient } from "@clickhouse/client";

const DATABASE_URL = process.env.DATABASE_URL;
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
if (!DATABASE_URL) {
  console.error("[backfill-counters] DATABASE_URL required");
  process.exit(1);
}
if (!CLICKHOUSE_URL) {
  console.error("[backfill-counters] CLICKHOUSE_URL required");
  process.exit(1);
}

const CHUNK_SIZE = 5000;

interface AggregateRow {
  address: string;
  sent: number;
  received: number;
  minLedger: number;
  maxLedger: number;
}

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} });
  const ch = createClient({
    url: CLICKHOUSE_URL!,
    database: process.env.CLICKHOUSE_DATABASE ?? "sonde",
    request_timeout: 300_000, // allow up to 5min for the big aggregate
  });

  try {
    console.log("[backfill-counters] aggregating sent counts from ClickHouse...");
    const t0 = Date.now();
    const sentRes = await ch.query({
      query: `
        SELECT
          account AS address,
          count() AS sent,
          min(ledger_index) AS min_ledger,
          max(ledger_index) AS max_ledger
        FROM transactions
        WHERE account != ''
        GROUP BY account
      `,
      format: "JSONEachRow",
    });
    const sentRows = await sentRes.json<{
      address: string;
      sent: string;
      min_ledger: number;
      max_ledger: number;
    }>();
    console.log(`[backfill-counters]   sent rows: ${sentRows.length.toLocaleString()} in ${Date.now() - t0}ms`);

    const t1 = Date.now();
    /* received: only count successful Payments. Tier 1.5 (2026-04-28)
     * tightened the live ingester's bumpCounter('received') to gate on
     * isSuccess + tx_type=Payment. This backfill must match the new
     * semantics or running it post-Tier-1.5 will re-inflate received
     * counts back to pre-fix values (an AccountDelete sweep also delivers
     * value to a destination, but the live counter doesn't track those —
     * see C5 in docs/wiki/architecture/tier1.5-audit-findings.md). */
    const receivedRes = await ch.query({
      query: `
        SELECT
          destination AS address,
          count() AS received,
          min(ledger_index) AS min_ledger,
          max(ledger_index) AS max_ledger
        FROM transactions
        WHERE destination != ''
          AND destination != account
          AND tx_type = 'Payment'
          AND result = 'tesSUCCESS'
        GROUP BY destination
      `,
      format: "JSONEachRow",
    });
    const receivedRows = await receivedRes.json<{
      address: string;
      received: string;
      min_ledger: number;
      max_ledger: number;
    }>();
    console.log(`[backfill-counters]   received rows: ${receivedRows.length.toLocaleString()} in ${Date.now() - t1}ms`);

    console.log("[backfill-counters] merging sent + received...");
    const merged = new Map<string, AggregateRow>();
    for (const r of sentRows) {
      merged.set(r.address, {
        address: r.address,
        sent: Number(r.sent),
        received: 0,
        minLedger: r.min_ledger,
        maxLedger: r.max_ledger,
      });
    }
    for (const r of receivedRows) {
      const existing = merged.get(r.address);
      if (existing) {
        existing.received = Number(r.received);
        if (r.min_ledger < existing.minLedger) existing.minLedger = r.min_ledger;
        if (r.max_ledger > existing.maxLedger) existing.maxLedger = r.max_ledger;
      } else {
        merged.set(r.address, {
          address: r.address,
          sent: 0,
          received: Number(r.received),
          minLedger: r.min_ledger,
          maxLedger: r.max_ledger,
        });
      }
    }
    const allRows = Array.from(merged.values());
    console.log(`[backfill-counters]   merged unique addresses: ${allRows.length.toLocaleString()}`);

    console.log("[backfill-counters] upserting into Postgres in chunks...");
    const t2 = Date.now();
    let written = 0;
    for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
      const chunk = allRows.slice(i, i + CHUNK_SIZE);
      // Raw-driver multi-row VALUES upsert. The backfill REPLACES counts (not
      // adds them) so re-runs reconcile instead of double-count.
      await sql`
        INSERT INTO account_tx_counts ${sql(
          chunk.map((r) => ({
            address: r.address,
            sent_count: r.sent,
            received_count: r.received,
            first_seen_ledger: r.minLedger,
            last_seen_ledger: r.maxLedger,
          })),
        )}
        ON CONFLICT (address) DO UPDATE SET
          sent_count = EXCLUDED.sent_count,
          received_count = EXCLUDED.received_count,
          first_seen_ledger = LEAST(COALESCE(account_tx_counts.first_seen_ledger, EXCLUDED.first_seen_ledger), EXCLUDED.first_seen_ledger),
          last_seen_ledger = GREATEST(COALESCE(account_tx_counts.last_seen_ledger, EXCLUDED.last_seen_ledger), EXCLUDED.last_seen_ledger),
          updated_at = now()
      `;
      written += chunk.length;
      if (written % (CHUNK_SIZE * 10) === 0 || written === allRows.length) {
        console.log(`[backfill-counters]   ${written.toLocaleString()} / ${allRows.length.toLocaleString()} (${Math.round((written / allRows.length) * 100)}%)`);
      }
    }
    console.log(`[backfill-counters] upsert done in ${Date.now() - t2}ms`);
    console.log(`[backfill-counters] complete.`);
  } finally {
    await ch.close();
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[backfill-counters] fatal:", err);
  process.exit(1);
});
