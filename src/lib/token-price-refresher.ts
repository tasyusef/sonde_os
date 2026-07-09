/**
 * TokenPriceRefresher — periodic job that derives a single canonical
 * XRP-denominated price for every token from the most recent DEX trade
 * and persists it to `token_metadata.latest_price` / `latest_price_at`.
 *
 * Why: /markets was rendering `—` for most of the 2,400+ tokens because
 * prices were only fetched at render-time by firing per-token book_offers
 * calls from the browser (limit: 1). Illiquid and AMM-only tokens have
 * no orderbook offers, so they always showed blank. Persisting prices
 * derived from actual traded fills gives us coverage for everything that
 * has changed hands in the last 24h, and keeps the list-render path
 * free of per-row RPC calls.
 *
 * Source ranking: right now only DEX trades (ClickHouse `dex_trades`)
 * in the last 24h. AMM spot price and orderbook midpoint are fallbacks
 * we can layer on later if coverage gaps persist.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { query } from "./clickhouse-client";
import logger from "./logger";

const log = logger.child({ module: "token-price-refresher" });

/** Refresh every 10 minutes. Chosen so /markets stays reasonably fresh
 *  without pounding ClickHouse — the aggregation runs against the last
 *  24h of `dex_trades` and touches every token per run. */
const POLL_INTERVAL = 10 * 60 * 1000;

/** Startup delay — gives IngestionManager, IntelIngestionManager, and
 *  amm-tvl-refresher a beat to settle before we hit ClickHouse. */
const INITIAL_POLL_DELAY = 60 * 1000;

/** Postgres batch size for upserts. Keeps the IN clause bounded. */
const UPSERT_BATCH_SIZE = 500;

interface PriceRow extends Record<string, unknown> {
  currency: string;
  issuer: string;
  price: number;
  latest_ts: string;
}

class TokenPriceRefresher {
  private running = false;
  private polling = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private initialTimeout: ReturnType<typeof setTimeout> | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    log.info("starting");

    // Delay the first poll so we don't compete with startup-heavy managers.
    this.initialTimeout = setTimeout(() => {
      this.poll().catch((err) => log.error({ err }, "initial poll failed"));
    }, INITIAL_POLL_DELAY);

    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => log.error({ err }, "scheduled poll failed"));
    }, POLL_INTERVAL);

    log.info({ pollMs: POLL_INTERVAL }, "started");
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    log.info("stopped");
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    const started = Date.now();

    try {
      const rows = await this.fetchLatestPrices();
      if (rows.length === 0) {
        log.info("no price rows returned from ClickHouse");
        return;
      }

      await this.upsertPrices(rows);
      log.info({ count: rows.length, elapsedMs: Date.now() - started }, "refreshed token prices");
    } catch (err) {
      log.error({ err }, "poll failed");
    } finally {
      this.polling = false;
    }
  }

  /**
   * Pull the most recent XRP-denominated trade per token in the last 24h.
   *
   * XRP can sit on either side of a trade. Unified price computation:
   *   • XRP on quote → price = quote_amount / base_amount (XRP per token)
   *   • XRP on base  → price = base_amount / quote_amount (XRP per token)
   * Non-XRP pairs are skipped — we can't price them without a cross-rate,
   * and they represent a tiny share of volume on XRPL.
   */
  private async fetchLatestPrices(): Promise<PriceRow[]> {
    return query<PriceRow>(
      `SELECT
         currency,
         issuer,
         argMax(price_xrp, timestamp) AS price,
         toString(max(timestamp)) AS latest_ts
       FROM (
         SELECT
           if(quote_currency = 'XRP', base_currency, quote_currency) AS currency,
           if(quote_currency = 'XRP', base_issuer, quote_issuer) AS issuer,
           timestamp,
           if(quote_currency = 'XRP',
              quote_amount / nullIf(base_amount, 0),
              base_amount / nullIf(quote_amount, 0)) AS price_xrp
         FROM dex_trades
         WHERE timestamp >= now() - INTERVAL 24 HOUR
           AND (base_currency = 'XRP' OR quote_currency = 'XRP')
       )
       WHERE isFinite(price_xrp) AND price_xrp > 0
       GROUP BY currency, issuer`,
    );
  }

  private async upsertPrices(rows: PriceRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
      const values = batch.map((r) => {
        // ClickHouse gives us "YYYY-MM-DD HH:MM:SS"; Postgres wants ISO.
        const isoTs = r.latest_ts.replace(" ", "T") + "Z";
        return sql`(${r.currency}, ${r.issuer}, ${r.price}, ${isoTs})`;
      });

      // Only update rows that already exist in token_metadata — don't
      // create phantom entries from dex_trades for tokens that aren't
      // registered yet (token_metadata gets auto-upserted by the main
      // ingestion pipeline when a token first trades).
      //
      // Explicit casts on the VALUES side because Postgres defaults to
      // text inside an unannotated VALUES clause.
      await db.execute(sql`
        UPDATE token_metadata AS t
        SET latest_price = v.price::numeric,
            latest_price_at = v.price_at::timestamptz
        FROM (VALUES ${sql.join(values, sql`, `)})
          AS v(currency, issuer, price, price_at)
        WHERE t.currency = v.currency AND t.issuer = v.issuer
      `);
    }
  }
}

export const tokenPriceRefresher = new TokenPriceRefresher();

export function initTokenPriceRefresher(): void {
  if (process.env.ENABLE_INGESTION !== "true") {
    log.info("disabled (ENABLE_INGESTION !== true)");
    return;
  }
  if (!process.env.DATABASE_URL) {
    log.info("disabled (no DATABASE_URL)");
    return;
  }
  if (!process.env.CLICKHOUSE_URL) {
    log.info("disabled (no CLICKHOUSE_URL — price source unavailable)");
    return;
  }

  tokenPriceRefresher.start().catch((err) => {
    log.error({ err }, "failed to start");
  });
}
