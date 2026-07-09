/**
 * One-off backfill of `nft_collection_daily_snapshots` for the
 * trailing 90 days.
 *
 * We can derive three of the four daily metrics retroactively from
 * event history:
 *   - listing_count + floor_drops: from `nft_offers`, by replaying
 *     created/closed timestamps to determine which offers were open
 *     on a given day.
 *   - volume_24h_drops + trade_count_24h: from `nft_trades`
 *     aggregated per day.
 *
 * `holder_count` is left at 0 for backfilled days. Reconstructing
 * historical holder sets would require walking trade events from
 * mint forward (since `nft_ownership` only stores current state)
 * which is much more involved. The live daily timer starts capturing
 * holder counts going forward from today.
 *
 * Loops day-by-day over the past 89 days (today is excluded — the
 * regular snapshot writer already wrote today's row with full
 * metrics including holders). One INSERT per day.
 *
 * Idempotent: re-running overwrites prior backfill rows via
 * `ReplacingMergeTree(snapshot_time)` since this script uses a
 * fresh `now()` as the version. Won't disturb today's snapshot
 * because we skip day 0.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-collection-snapshots.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import logger from "../src/lib/logger";

const log = logger.child({ module: "backfill-collection-snapshots" });

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const DATABASE = process.env.CLICKHOUSE_DATABASE ?? "sonde";

const ch = createClient({
  url: CLICKHOUSE_URL,
  database: DATABASE,
  request_timeout: 600_000,
  http_headers:
    process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
      ? {
          "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
          "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
        }
      : undefined,
});

const BACKFILL_DAYS = 89; // 1..89 days ago. Today (day 0) is owned by the live timer.

function formatDay(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function backfillDay(day: string): Promise<number> {
  // For this day's snapshot, an offer is "open" if it was created
  // on or before this day AND hasn't been closed yet (or was closed
  // strictly after this day). Floor = min(amount_drops) over those.
  // Volume = trades whose timestamp falls within this UTC day.
  //
  // CTE + FINAL JOIN had alias-scoping issues in CH parser — same
  // class of error the daily-snapshot script hit. Rewriting as
  // discrete aggregations + JS-side merge mirrors the working
  // daily-snapshot pattern.

  type IssuerTaxon = { issuer: string; taxon: number };
  type OffersAgg = IssuerTaxon & {
    floor_drops: string;
    listing_count: number;
  };
  type TradesAgg = IssuerTaxon & {
    volume_drops: string;
    trade_count: number;
  };

  const activeResult = await ch.query({
    query: `
      SELECT issuer, taxon
      FROM nft_trades
      WHERE timestamp >= now() - INTERVAL 90 DAY
      GROUP BY issuer, taxon
    `,
    format: "JSONEachRow",
  });
  const active = (await activeResult.json()) as IssuerTaxon[];

  const offersResult = await ch.query({
    query: `
      SELECT
        m.issuer AS issuer,
        m.taxon AS taxon,
        toString(min(o.amount_drops)) AS floor_drops,
        toUInt32(count()) AS listing_count
      FROM nft_offers AS o FINAL
      INNER JOIN (
        SELECT nft_id, issuer, taxon
        FROM nft_static_metadata FINAL
      ) AS m USING nft_id
      WHERE bitAnd(o.flags, 1) = 1
        AND o.currency = 'XRP'
        AND o.amount_drops > 0
        AND toDate(o.created_timestamp) <= toDate('${day}')
        AND (o.closed_ledger = 0 OR toDate(o.closed_timestamp) > toDate('${day}'))
      GROUP BY m.issuer, m.taxon
    `,
    format: "JSONEachRow",
  });
  const offers = (await offersResult.json()) as OffersAgg[];
  const offersByKey = new Map(
    offers.map((o) => [`${o.issuer}|${o.taxon}`, o]),
  );

  const tradesResult = await ch.query({
    query: `
      SELECT
        issuer,
        taxon,
        toString(sumIf(amount_drops, is_xrp = 1)) AS volume_drops,
        toUInt32(count()) AS trade_count
      FROM nft_trades
      WHERE toDate(timestamp) = toDate('${day}')
      GROUP BY issuer, taxon
    `,
    format: "JSONEachRow",
  });
  const trades = (await tradesResult.json()) as TradesAgg[];
  const tradesByKey = new Map(
    trades.map((t) => [`${t.issuer}|${t.taxon}`, t]),
  );

  const nowDateTime = `${new Date().toISOString().slice(0, 10)} ${new Date().toISOString().slice(11, 19)}`;

  const rows = active.map((a) => {
    const key = `${a.issuer}|${a.taxon}`;
    const o = offersByKey.get(key);
    const t = tradesByKey.get(key);
    return {
      issuer: a.issuer,
      taxon: Number(a.taxon),
      day,
      floor_drops: o?.floor_drops ?? "0",
      listing_count: o?.listing_count ?? 0,
      holder_count: 0,
      volume_24h_drops: t?.volume_drops ?? "0",
      trade_count_24h: t?.trade_count ?? 0,
      snapshot_time: nowDateTime,
    };
  });

  if (rows.length > 0) {
    await ch.insert({
      table: "nft_collection_daily_snapshots",
      values: rows,
      format: "JSONEachRow",
    });
  }

  return rows.length;
}

async function run() {
  const startedAt = Date.now();
  log.info({ backfillDays: BACKFILL_DAYS }, "Backfill started");

  for (let daysAgo = BACKFILL_DAYS; daysAgo >= 1; daysAgo--) {
    const day = formatDay(daysAgo);
    const dayStart = Date.now();
    try {
      const count = await backfillDay(day);
      log.info(
        {
          day,
          daysAgo,
          rowsThisDay: count,
          elapsedMs: Date.now() - dayStart,
          totalElapsedSec: Math.round((Date.now() - startedAt) / 1000),
        },
        "Day backfilled",
      );
    } catch (err) {
      log.error({ day, daysAgo, err }, "Day backfill failed; continuing");
    }
  }

  log.info(
    { elapsedSec: Math.round((Date.now() - startedAt) / 1000) },
    "Backfill complete",
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error({ err }, "Fatal error");
    process.exit(1);
  });
