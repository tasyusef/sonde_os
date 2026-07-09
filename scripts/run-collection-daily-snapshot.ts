/**
 * Daily NFT collection metric snapshotter.
 *
 * Walks "active" collections — any (issuer, taxon) pair with at least
 * one trade in the last 30 days — and writes one row into
 * `nft_collection_daily_snapshots` per collection per day. The row
 * captures four metrics that can't be reconstructed from event
 * history retroactively:
 *
 *   - floor_drops:      lowest open XRP sell-offer amount, in drops
 *   - listing_count:    open XRP sell-offers
 *   - holder_count:     distinct owners of unburned NFTs in the
 *                       collection
 *   - volume_24h_drops: XRP volume in the trailing 24h
 *   - trade_count_24h:  trade count in the trailing 24h
 *
 * Runs as `sonde-nft-collection-snapshot.timer` (daily ~01:30 UTC,
 * between the smart-money scorer at 00:46 and the collection-resolver
 * at 02:30). One single INSERT...SELECT computes every metric for
 * every active collection in a few seconds — no per-collection loop.
 *
 * Idempotent: if you run it twice on the same day, the
 * `ReplacingMergeTree(snapshot_time)` engine keeps the later row for
 * each (issuer, taxon, day) key.
 *
 * Usage:
 *   pnpm tsx scripts/run-collection-daily-snapshot.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import logger from "../src/lib/logger";

const log = logger.child({ module: "collection-daily-snapshot" });

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const DATABASE = process.env.CLICKHOUSE_DATABASE ?? "sonde";

const ch = createClient({
  url: CLICKHOUSE_URL,
  database: DATABASE,
  request_timeout: 300_000,
  http_headers:
    process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
      ? {
          "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
          "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
        }
      : undefined,
});

async function run() {
  const startedAt = Date.now();
  log.info("Collection daily snapshot — starting");

  // Compute each metric separately, JOIN client-side, INSERT in one
  // batch. ClickHouse's CTE+JOIN inside an INSERT...SELECT has
  // alias-scoping quirks that bit us in the first attempt; doing
  // four cheap aggregations and a JS-side merge is cleaner and just
  // as fast for the active-collection cardinality (~1k rows).
  //
  // "Active" = had at least one trade in the last 30 days. Filters
  // out the long tail of dead collections so we don't snapshot
  // millions of rows daily for cold (issuer, taxon) pairs nobody's
  // looked at in years.

  const todayDate = new Date().toISOString().slice(0, 10);
  const nowDateTime = `${todayDate} ${new Date().toISOString().slice(11, 19)}`;

  type IssuerTaxon = { issuer: string; taxon: number };
  type ListingsAgg = IssuerTaxon & { floor_drops: string; listing_count: number };
  type HoldersAgg = IssuerTaxon & { holder_count: number };
  type VolumeAgg = IssuerTaxon & { volume_24h_drops: string; trade_count_24h: number };

  // 1. Active collections — anything with a trade in the last 30d.
  const activeResult = await ch.query({
    query: `
      SELECT issuer, taxon
      FROM nft_trades
      WHERE timestamp >= now() - INTERVAL 30 DAY
      GROUP BY issuer, taxon
    `,
    format: "JSONEachRow",
  });
  const active = (await activeResult.json()) as IssuerTaxon[];
  log.info({ activeCount: active.length }, "active collections discovered");

  // 2. Listings: floor + count of open XRP sell offers per collection.
  const listingsResult = await ch.query({
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
      WHERE o.closed_ledger = 0
        AND bitAnd(o.flags, 1) = 1
        AND o.currency = 'XRP'
        AND o.amount_drops > 0
      GROUP BY m.issuer, m.taxon
    `,
    format: "JSONEachRow",
  });
  const listings = (await listingsResult.json()) as ListingsAgg[];
  const listingsByKey = new Map(
    listings.map((l) => [`${l.issuer}|${l.taxon}`, l]),
  );

  // 3. Holders: distinct unburned owners per collection.
  const holdersResult = await ch.query({
    query: `
      SELECT
        m.issuer AS issuer,
        m.taxon AS taxon,
        toUInt32(uniqExact(o.owner)) AS holder_count
      FROM nft_ownership AS o FINAL
      INNER JOIN (
        SELECT nft_id, issuer, taxon
        FROM nft_static_metadata FINAL
      ) AS m USING nft_id
      WHERE o.is_burned = 0
      GROUP BY m.issuer, m.taxon
    `,
    format: "JSONEachRow",
  });
  const holders = (await holdersResult.json()) as HoldersAgg[];
  const holdersByKey = new Map(
    holders.map((h) => [`${h.issuer}|${h.taxon}`, h]),
  );

  // 4. Last-24h XRP volume + trade count per collection.
  const volResult = await ch.query({
    query: `
      SELECT
        issuer,
        taxon,
        toString(sumIf(amount_drops, is_xrp = 1)) AS volume_24h_drops,
        toUInt32(count()) AS trade_count_24h
      FROM nft_trades
      WHERE timestamp >= now() - INTERVAL 24 HOUR
      GROUP BY issuer, taxon
    `,
    format: "JSONEachRow",
  });
  const volumes = (await volResult.json()) as VolumeAgg[];
  const volByKey = new Map(volumes.map((v) => [`${v.issuer}|${v.taxon}`, v]));

  // 5. Merge: one snapshot row per active collection.
  const rows = active.map((a) => {
    const key = `${a.issuer}|${a.taxon}`;
    const l = listingsByKey.get(key);
    const h = holdersByKey.get(key);
    const v = volByKey.get(key);
    return {
      issuer: a.issuer,
      taxon: Number(a.taxon),
      day: todayDate,
      floor_drops: l?.floor_drops ?? "0",
      listing_count: l?.listing_count ?? 0,
      holder_count: h?.holder_count ?? 0,
      volume_24h_drops: v?.volume_24h_drops ?? "0",
      trade_count_24h: v?.trade_count_24h ?? 0,
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

  // Report what got written.
  const result = await ch.query({
    query: `
      SELECT count() AS rows
      FROM nft_collection_daily_snapshots
      WHERE day = today()
    `,
    format: "JSONEachRow",
  });
  const verifyRows = (await result.json()) as Array<{ rows: string | number }>;
  const writtenCount = Number(verifyRows[0]?.rows ?? 0);

  log.info(
    {
      writtenCount,
      elapsedMs: Date.now() - startedAt,
    },
    "Collection daily snapshot — done",
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error({ err }, "Fatal error");
    process.exit(1);
  });
