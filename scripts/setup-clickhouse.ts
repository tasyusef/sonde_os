/**
 * ClickHouse schema setup — creates the sonde database, transactions table,
 * and materialized views for the intelligence layer.
 *
 * Usage:
 *   pnpm tsx scripts/setup-clickhouse.ts                       # uses .env.local CLICKHOUSE_URL/DATABASE
 *   CLICKHOUSE_DATABASE=sonde_smoketest pnpm tsx scripts/...   # smoketest target
 *
 * Loads .env.local automatically (CLAUDE.md gotcha — without dotenv it
 * silently fell back to http://localhost:8123 on dev machines).
 * Idempotent — safe to run multiple times.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const DATABASE = process.env.CLICKHOUSE_DATABASE ?? "sonde";

const client = createClient({ url: CLICKHOUSE_URL });

async function run(sql: string, label: string) {
  console.log(`  [+] ${label}`);
  await client.command({ query: sql });
}

async function main() {
  console.log(`ClickHouse setup — ${CLICKHOUSE_URL}\n`);

  // ── Database ──────────────────────────────────────────────────────
  await run(`CREATE DATABASE IF NOT EXISTS ${DATABASE}`, `database: ${DATABASE}`);

  // ── Transactions table ────────────────────────────────────────────
  // Raw XRPL transactions. This is the core table for time-series queries.
  // Partitioned monthly, ordered by (account, timestamp) for fast account lookups.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.transactions (
      tx_hash        FixedString(64),
      tx_type        LowCardinality(String),
      account        String,
      destination    String DEFAULT '',
      amount_drops   Int64 DEFAULT 0,
      amount_iou     String DEFAULT '',
      currency       LowCardinality(String) DEFAULT 'XRP',
      issuer         String DEFAULT '',
      fee_drops      UInt32,
      timestamp      DateTime,
      ledger_index   UInt32,
      result         LowCardinality(String),
      memo           String DEFAULT '',
      memo_type      LowCardinality(String) DEFAULT '',
      memo_format    LowCardinality(String) DEFAULT '',
      tx_json        String DEFAULT '' CODEC(ZSTD(3)),
      meta_json      String DEFAULT '' CODEC(ZSTD(3)),
      nftoken_id     FixedString(64) DEFAULT toFixedString('0', 64),
      flags          UInt32 DEFAULT 0,
      sequence       UInt32 DEFAULT 0,
      source_tag     UInt32 DEFAULT 0,
      destination_tag UInt32 DEFAULT 0,
      delivered_amount_drops Int64 DEFAULT 0,
      delivered_amount_iou   String DEFAULT '',
      last_ledger_sequence UInt32 DEFAULT 0,
      ticket_sequence UInt32 DEFAULT 0,
      signing_pub_key String DEFAULT '',
      network_id UInt32 DEFAULT 0,
      INDEX idx_ledger_index ledger_index TYPE minmax GRANULARITY 1,
      INDEX idx_tx_hash_v2 tx_hash TYPE bloom_filter(0.001) GRANULARITY 1
    )
    ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (account, timestamp, tx_hash)
    SETTINGS index_granularity = 8192`,
    "table: transactions",
  );

  // Tighter bloom on tx_hash — 2026-05-08 swap. The original
  // `bloom_filter` (default 0.025 FPP) GRANULARITY 4 was effectively
  // useless for IN-list lookups: with a 50-element set the per-granule
  // false-positive rate compounds to ~72%, so receiver-side queries
  // (`SELECT … FROM transactions WHERE tx_hash IN (subq)`) survived
  // 70% of granules and ran in 9+s on real data.
  //
  // bloom_filter(0.001) GRANULARITY 1 brings per-granule FPP for a
  // 50-set down to ~5%, which prunes ~95% of granules on the same
  // workload. Receiver query: 9.2s → 0.93s (full payload, prod test).
  //
  // For existing DBs that still carry the legacy `idx_tx_hash`, add v2
  // alongside, MATERIALIZE, then drop the old one. Idempotent — both
  // ADD and DROP are guarded by IF EXISTS / IF NOT EXISTS semantics.
  await run(
    `ALTER TABLE ${DATABASE}.transactions
     ADD INDEX IF NOT EXISTS idx_tx_hash_v2 tx_hash TYPE bloom_filter(0.001) GRANULARITY 1`,
    "alter: transactions ADD INDEX idx_tx_hash_v2 (idempotent)",
  );
  await run(
    `ALTER TABLE ${DATABASE}.transactions DROP INDEX IF EXISTS idx_tx_hash`,
    "alter: transactions DROP INDEX idx_tx_hash (legacy, idempotent)",
  );

  // ── account_tx_index ──────────────────────────────────────────────
  // Per-account inverted index for tx history. Solves the "AffectedNodes-
  // only relationships" gap: txs that affect an account through metadata
  // (offer crossed, AMM LP shares moved, trustline peer balance changed,
  // AccountRoot modified by a side effect) without the account being the
  // sender or destination.
  //
  // One row per (account, tx) where the account is touched in any role
  // OTHER than direct sender/destination. Sender/destination coverage
  // already comes from the `transactions` PK (`account` column) and the
  // `value_transfer_events` table — the index is the AffectedNodes-only
  // delta, NOT a full mirror.
  //
  // role values:
  //   - offer_owner            their offer was modified/deleted (crossed)
  //   - amm_lp                 their LP RippleState with an AMM moved
  //   - trustline_peer         RippleState peer side modified (non-AMM)
  //   - account_root_modified  AccountRoot changed by a tx where they're
  //                            not Account / Destination
  //
  // ORDER BY puts `account` first so per-account lookups are partition-
  // pruned + range-scanned. `role` is in the dedup key so a single
  // account in multiple roles for the same tx survives ReplacingMergeTree.
  // No Float64 in ORDER BY (Tier 1.5 C2 lesson).
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.account_tx_index (
      account       String,
      timestamp     DateTime,
      tx_hash       FixedString(64),
      ledger_index  UInt32,
      tx_type       LowCardinality(String),
      role          LowCardinality(String)
    )
    ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (account, timestamp, tx_hash, role)
    SETTINGS index_granularity = 8192`,
    "table: account_tx_index",
  );

  // ── Value-transfer events table ───────────────────────────────────
  // Unified log of every value-moving tx (Payment, AccountDelete,
  // CheckCash, EscrowFinish, PaymentChannelClaim, XChainClaim).
  // System-of-record for Neo4j PAYMENT edge derivation. The transactions
  // table is the raw tx feed; this is the projected value flow.
  // ORDER BY includes from_account, currency, issuer so dual-asset rows
  // (e.g. AMMDeposit pairs writing to/from the same AMM in two currencies)
  // don't collide on dedup. See docs/wiki/architecture/tier1.5-audit-findings.md C3.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.value_transfer_events (
      tx_hash         FixedString(64),
      ledger_index    UInt32,
      timestamp       DateTime,
      tx_type         LowCardinality(String),
      transfer_kind   LowCardinality(String),
      from_account    String,
      to_account      String,
      amount_drops    Int64 DEFAULT 0,
      amount_iou      String DEFAULT '',
      currency        LowCardinality(String) DEFAULT 'XRP',
      issuer          String DEFAULT '',
      INDEX idx_from_account from_account TYPE bloom_filter GRANULARITY 1
    )
    ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (to_account, timestamp, tx_hash, from_account, currency, issuer)
    SETTINGS index_granularity = 8192`,
    "table: value_transfer_events",
  );

  // ── DEX trades table ──────────────────────────────────────────────
  // Individual DEX fills from OfferCreate AND cross-currency Payment.
  // Each fill (book offer crossing or AMM swap) becomes a row.
  // - fill_index disambiguates multi-fill case (one tx → multiple fills
  //   from same maker), preventing dedup-eat on replay.
  // - base_amount/quote_amount kept as Float64 for chart aggregation;
  //   base_amount_iou/quote_amount_iou hold lossless decimal strings for
  //   exact IOU math. Pre-Tier-1.5 the Float64 amounts were in the ORDER BY
  //   which made them part of the dedup key — phantom-duplicate hazard.
  // - ReplacingMergeTree(timestamp) explicit version for deterministic
  //   dedup on replay. See docs/wiki/architecture/tier1.5-audit-findings.md C1+C2.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.dex_trades (
      tx_hash          FixedString(64),
      fill_index       UInt8 DEFAULT 0,
      timestamp        DateTime,
      ledger_index     UInt32,
      taker            String,
      maker            String,
      base_currency    LowCardinality(String),
      base_issuer      String DEFAULT '',
      base_amount      Float64,
      base_amount_iou  String DEFAULT '',
      quote_currency   LowCardinality(String),
      quote_issuer     String DEFAULT '',
      quote_amount     Float64,
      quote_amount_iou String DEFAULT '',
      price            Float64,
      xrp_volume_drops Int64 DEFAULT 0,
      INDEX idx_taker taker TYPE bloom_filter GRANULARITY 1,
      INDEX idx_maker maker TYPE bloom_filter GRANULARITY 1
    )
    ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (timestamp, tx_hash, fill_index)
    SETTINGS index_granularity = 8192`,
    "table: dex_trades",
  );

  // ── Materialized views ────────────────────────────────────────────

  // Hourly transaction volume by type
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_hourly_tx_volume (
      hour     DateTime,
      tx_type  LowCardinality(String),
      count    UInt64,
      total_fee_drops UInt64
    )
    ENGINE = SummingMergeTree()
    PARTITION BY toYYYYMM(hour)
    ORDER BY (hour, tx_type)`,
    "table: mv_hourly_tx_volume (target)",
  );

  // Filter to tesSUCCESS so the volume metric reflects actual successful
  // operations rather than including failed-but-fee-burning txs. Use the
  // mv_fee_burn_hourly view for fee-burn metrics (which DOES count all
  // results, intentionally — XRPL burns fees even on tec/tef failures).
  // NOTE: existing deployments may have the old definition without this
  // filter; the historical aggregated rows in mv_hourly_tx_volume include
  // failures. Going forward, new rows will be tesSUCCESS-only. To rebuild
  // historical data: DROP + recreate the target table + view + replay.
  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_hourly_tx_volume_view
    TO ${DATABASE}.mv_hourly_tx_volume AS
    SELECT
      toStartOfHour(timestamp) AS hour,
      tx_type,
      count() AS count,
      sum(fee_drops) AS total_fee_drops
    FROM ${DATABASE}.transactions
    WHERE result = 'tesSUCCESS'
    GROUP BY hour, tx_type`,
    "materialized view: hourly_tx_volume",
  );

  // Daily active accounts (uses AggregatingMergeTree for correct distinct counts)
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_daily_active_accounts (
      day            Date,
      unique_accounts AggregateFunction(uniqExact, String)
    )
    ENGINE = AggregatingMergeTree()
    PARTITION BY toYYYYMM(day)
    ORDER BY day`,
    "table: mv_daily_active_accounts (target)",
  );

  // Active-accounts MV excludes pseudo-tx rows (sentinel '__pseudo_tx__'
  // for EnableAmendment/SetFee/UNLModify and historical empty-account
  // rows). Without this, the unique-account count includes the sentinel
  // address as one extra "account" each day.
  // Also filters to tesSUCCESS — the metric is "accounts that successfully
  // executed any tx that day," not "accounts that submitted anything".
  // NOTE: existing deployments may have the old definition without the
  // tesSUCCESS filter. To apply: DROP + CREATE the view (loses MV state
  // but is recomputed from transactions on next insert), OR run a one-off
  // INSERT...SELECT to backfill. Tracked in docs/runbooks/phase-2-backfill.md §1.
  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_daily_active_accounts_view
    TO ${DATABASE}.mv_daily_active_accounts AS
    SELECT
      toDate(timestamp) AS day,
      uniqExactState(account) AS unique_accounts
    FROM ${DATABASE}.transactions
    WHERE account NOT IN ('', '__pseudo_tx__')
      AND result = 'tesSUCCESS'
    GROUP BY day`,
    "materialized view: daily_active_accounts",
  );

  // Daily DEX pair summary
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_dex_pair_daily (
      day            Date,
      base_currency  LowCardinality(String),
      base_issuer    String,
      quote_currency LowCardinality(String),
      quote_issuer   String,
      trade_count    UInt64,
      base_volume    Float64,
      quote_volume   Float64,
      xrp_volume_drops Int64
    )
    ENGINE = SummingMergeTree()
    PARTITION BY toYYYYMM(day)
    ORDER BY (day, base_currency, base_issuer, quote_currency, quote_issuer)`,
    "table: mv_dex_pair_daily (target)",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_dex_pair_daily_view
    TO ${DATABASE}.mv_dex_pair_daily AS
    SELECT
      toDate(timestamp) AS day,
      base_currency,
      base_issuer,
      quote_currency,
      quote_issuer,
      count() AS trade_count,
      sum(base_amount) AS base_volume,
      sum(quote_amount) AS quote_volume,
      sum(xrp_volume_drops) AS xrp_volume_drops
    FROM ${DATABASE}.dex_trades
    GROUP BY day, base_currency, base_issuer, quote_currency, quote_issuer`,
    "materialized view: dex_pair_daily",
  );

  // ── Trustline events table ──────────────────────────────────────────
  // TrustSet transactions extracted during intel ingestion.
  // Tracks trustline creation, modification, and deletion per token.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.trustline_events (
      tx_hash        FixedString(64),
      ledger_index   UInt32,
      timestamp      DateTime,
      account        String,
      currency       LowCardinality(String),
      issuer         String,
      limit_amount   Float64,
      action         Enum8('set' = 1, 'delete' = 2)
    )
    ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (currency, issuer, timestamp, account)
    SETTINGS index_granularity = 8192`,
    "table: trustline_events",
  );

  // Daily trustline counts per token (auto-aggregated from trustline_events)
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_trustline_counts (
      currency       LowCardinality(String),
      issuer         String,
      event_date     Date,
      trustlines_added   UInt64,
      trustlines_removed UInt64
    )
    ENGINE = SummingMergeTree()
    PARTITION BY toYYYYMM(event_date)
    ORDER BY (currency, issuer, event_date)`,
    "table: mv_trustline_counts (target)",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_trustline_counts_view
    TO ${DATABASE}.mv_trustline_counts AS
    SELECT
      currency,
      issuer,
      toDate(timestamp) AS event_date,
      countIf(action = 'set') AS trustlines_added,
      countIf(action = 'delete') AS trustlines_removed
    FROM ${DATABASE}.trustline_events
    GROUP BY currency, issuer, event_date`,
    "materialized view: trustline_counts",
  );

  // ── Wallet token PnL (smart money scoring) ─────────────────────────
  // Pre-computed WAVG cost basis and realized PnL per wallet per token.
  // ReplacingMergeTree deduplicates by (wallet, currency, issuer), keeping latest updated_at.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.wallet_token_pnl (
      wallet           String,
      currency         LowCardinality(String),
      issuer           String DEFAULT '',
      cost_basis       Float64 DEFAULT 0,
      total_qty        Float64 DEFAULT 0,
      total_cost       Float64 DEFAULT 0,
      realized_pnl     Float64 DEFAULT 0,
      trade_count      UInt32 DEFAULT 0,
      buy_count        UInt32 DEFAULT 0,
      sell_count       UInt32 DEFAULT 0,
      win              UInt8 DEFAULT 0,
      first_trade_ts   DateTime DEFAULT '1970-01-01 00:00:00',
      last_trade_ts    DateTime DEFAULT '1970-01-01 00:00:00',
      xrp_volume_drops Float64 DEFAULT 0,
      updated_at       DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(updated_at)
    PARTITION BY tuple()
    ORDER BY (wallet, currency, issuer)
    SETTINGS index_granularity = 8192`,
    "table: wallet_token_pnl",
  );

  // ── NFT trades ─────────────────────────────────────────────────────
  // One row per NFTokenAcceptOffer fill. Replaces PG `recent_nft_trades`
  // and feeds the `nft_volume_*` MVs below.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.nft_trades (
      tx_hash          FixedString(64),
      ledger_index     UInt32,
      timestamp        DateTime,
      nft_id           FixedString(64),
      issuer           String,
      taxon            UInt32 DEFAULT 0,
      seller           String,
      buyer            String,
      broker           String DEFAULT '',
      marketplace      LowCardinality(String) DEFAULT '',
      amount_drops     Int64 DEFAULT 0,
      amount_currency  LowCardinality(String) DEFAULT 'XRP',
      amount_issuer    String DEFAULT '',
      amount_value     String DEFAULT '',
      is_xrp           UInt8 DEFAULT 1
    )
    ENGINE = ReplacingMergeTree()
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (tx_hash, nft_id)
    SETTINGS index_granularity = 8192`,
    "table: nft_trades",
  );

  // Hourly NFT volume by issuer × marketplace
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_nft_volume_hourly (
      hour              DateTime,
      issuer            String,
      marketplace       LowCardinality(String),
      trade_count       UInt64,
      xrp_volume_drops  Int64
    )
    ENGINE = SummingMergeTree()
    PARTITION BY toYYYYMM(hour)
    ORDER BY (hour, issuer, marketplace)`,
    "table: mv_nft_volume_hourly (target)",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_nft_volume_hourly_view
    TO ${DATABASE}.mv_nft_volume_hourly AS
    SELECT
      toStartOfHour(timestamp) AS hour,
      issuer,
      marketplace,
      countIf(is_xrp = 1) AS trade_count,
      sumIf(amount_drops, is_xrp = 1) AS xrp_volume_drops
    FROM ${DATABASE}.nft_trades
    GROUP BY hour, issuer, marketplace`,
    "materialized view: nft_volume_hourly",
  );

  // Daily NFT volume by issuer × marketplace
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_nft_volume_daily (
      day               Date,
      issuer            String,
      marketplace       LowCardinality(String),
      trade_count       UInt64,
      xrp_volume_drops  Int64
    )
    ENGINE = SummingMergeTree()
    PARTITION BY toYYYYMM(day)
    ORDER BY (day, issuer, marketplace)`,
    "table: mv_nft_volume_daily (target)",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_nft_volume_daily_view
    TO ${DATABASE}.mv_nft_volume_daily AS
    SELECT
      toDate(timestamp) AS day,
      issuer,
      marketplace,
      countIf(is_xrp = 1) AS trade_count,
      sumIf(amount_drops, is_xrp = 1) AS xrp_volume_drops
    FROM ${DATABASE}.nft_trades
    GROUP BY day, issuer, marketplace`,
    "materialized view: nft_volume_daily",
  );

  // ── NFT offers (active state mirror) ──────────────────────────────
  // Current state of every NFTokenOffer ledger entry. Mirrored from
  // chain by the ingester reading `meta.AffectedNodes` on the four NFT
  // offer-related tx types: NFTokenCreateOffer (insert), CancelOffer
  // (mark closed), AcceptOffer (mark closed + transfer ownership in
  // nft_ownership). Active offers have `closed_ledger = 0`.
  //
  // Replaces the per-NFT `nft_buy_offers` rippled fan-out for the
  // OffersTab Incoming view. Without this table, that view is O(N) in
  // NFT count (each NFT = one WS round-trip). With this table, it's
  // a single CH query that runs in under 100ms regardless of how many
  // NFTs the account holds.
  //
  // Indexes:
  //   - bloom on nft_id — for the "offers on these NFT IDs" IN-list
  //     pattern. Same FPP/granularity as the post-bloom-fix idx_tx_hash
  //     on transactions.
  //   - bloom on owner — for "outgoing NFT offers BY this account"
  //     queries. Looser FPP since this is less hot.
  //
  // ReplacingMergeTree(last_updated): a single offer can have multiple
  // state updates (created, then closed). The engine keeps the latest
  // version per offer index after merge.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.nft_offers (
      nft_offer_index    FixedString(64),
      nft_id             FixedString(64),
      owner              String,
      amount_drops       Int64 DEFAULT 0,
      amount_iou         String DEFAULT '',
      currency           LowCardinality(String) DEFAULT 'XRP',
      issuer             String DEFAULT '',
      destination        String DEFAULT '',
      expiration_xrpl    UInt32 DEFAULT 0,
      flags              UInt32 DEFAULT 0,
      created_ledger     UInt32,
      created_timestamp  DateTime,
      closed_ledger      UInt32 DEFAULT 0,
      closed_timestamp   DateTime DEFAULT toDateTime(0),
      closed_reason      LowCardinality(String) DEFAULT '',
      last_updated       DateTime DEFAULT now(),
      INDEX idx_nft_id nft_id TYPE bloom_filter(0.001) GRANULARITY 1,
      INDEX idx_owner owner TYPE bloom_filter(0.01) GRANULARITY 4
    )
    ENGINE = ReplacingMergeTree(last_updated)
    PARTITION BY toYYYYMM(created_timestamp)
    ORDER BY nft_offer_index
    SETTINGS index_granularity = 8192`,
    "table: nft_offers",
  );

  // ── Trustlines (current state mirror) ────────────────────────────
  // Current state of every RippleState ledger entry, denormalized per
  // perspective: each on-chain entry produces TWO rows, one keyed on
  // each side's account. Lets per-account queries "all trustlines for
  // X" run as a partition prune + range scan instead of `WHERE high_acc
  // = X OR low_acc = X` which doesn't index well.
  //
  // Replaces the rippled `account_objects` paginate-all on whale
  // accounts (Sologenic-class with 10k+ trustlines) — same shape of win
  // as nft_offers for the NFT case. Per the slow-paths inventory
  // (docs/plans/slow-paths-inventory-2026-05-08.md), three of the top
  // portfolio-route hotspots paginate-all account_objects primarily for
  // trustline data; this table covers them all.
  //
  // Sign convention on `balance_value`: signed decimal string from the
  // `account` row's perspective.
  //   - Positive: counterparty owes account (account holds tokens)
  //   - Negative: account owes counterparty (rare, mostly AMM LP)
  //
  // `is_lp` heuristic: AMM LP tokens use 40-char hex currency codes
  // starting with "03" per the AMM amendment spec. Cheap, deterministic,
  // matches the partitionTrustLines logic in @/lib/amm-helpers.
  //
  // Bloom on counterparty for "all trustlines TO this issuer" lookups
  // (issuer profile pages). Per-account lookups don't need a bloom —
  // the leading PK column handles them.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.trustlines (
      account             String,
      counterparty        String,
      currency            LowCardinality(String),
      balance_value       String DEFAULT '0',
      account_limit       String DEFAULT '0',
      counterparty_limit  String DEFAULT '0',
      flags               UInt32 DEFAULT 0,
      is_lp               UInt8 DEFAULT 0,
      is_burned           UInt8 DEFAULT 0,
      ledger_index        UInt32 DEFAULT 0,
      last_updated        DateTime,
      INDEX idx_counterparty counterparty TYPE bloom_filter(0.01) GRANULARITY 4
    )
    ENGINE = ReplacingMergeTree(last_updated)
    PARTITION BY tuple()
    ORDER BY (account, currency, counterparty)
    SETTINGS index_granularity = 8192`,
    "table: trustlines",
  );

  // ── NFT ownership (current owner per NFTokenID) ───────────────────
  // Current owner of every NFT (or burned). Updated on:
  //   - NFTokenMint  → insert with owner = minter (or Issuer if delegated)
  //   - NFTokenBurn  → set is_burned = 1
  //   - NFTokenAcceptOffer → owner = new holder
  //
  // Used as the input filter to the nft_offers query: "all NFTs owned
  // by X" → list of nft_ids → "all active offers on those nft_ids".
  // Without partitioning since NFT lifecycle isn't strongly time-
  // bound; the bloom on owner does the prune work.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.nft_ownership (
      nft_id              FixedString(64),
      owner               String,
      acquired_ledger     UInt32,
      acquired_tx_hash    FixedString(64),
      acquired_timestamp  DateTime,
      is_burned           UInt8 DEFAULT 0,
      last_updated        DateTime DEFAULT now(),
      INDEX idx_owner owner TYPE bloom_filter(0.01) GRANULARITY 4
    )
    ENGINE = ReplacingMergeTree(last_updated)
    PARTITION BY tuple()
    ORDER BY nft_id
    SETTINGS index_granularity = 8192`,
    "table: nft_ownership",
  );

  // ── NFT static metadata (set-once-at-mint fields) ────────────────
  // URI lives here, not on `nft_ownership`, because URIs are
  // immutable per XLS-20 (set on NFTokenMint, never altered) while
  // ownership rotates with every transfer. Putting them on the same
  // ReplacingMergeTree row would let a transfer's empty-URI write
  // clobber the mint's URI on merge (ReplacingMergeTree replaces the
  // whole row by version). A separate table with the same `nft_id`
  // PK lets us join cheaply without that lifecycle conflict.
  //
  // This table is populated by NFTokenMint events only — transfers
  // and burns don't touch it. Reads are typically `nft_ownership FINAL
  // LEFT JOIN nft_static_metadata FINAL ON nft_id`.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.nft_static_metadata (
      nft_id            FixedString(64),
      uri               String DEFAULT '',
      issuer            String,
      taxon             UInt32 DEFAULT 0,
      minted_ledger     UInt32 DEFAULT 0,
      minted_timestamp  DateTime,
      last_updated      DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(last_updated)
    PARTITION BY tuple()
    ORDER BY nft_id
    SETTINGS index_granularity = 8192`,
    "table: nft_static_metadata",
  );

  // ── Account tx counts (PG → CH migration, Phase 2) ───────────────
  // Per-account lifetime tx counters: sent (from `transactions`),
  // received (from `value_transfer_events`), first/last seen ledger.
  // SimpleAggregateFunction(sum/min/max) because the merge logic is
  // exactly that — incremental sums and bounded-extrema. Reads use
  // GROUP BY account + sum/min/max to fold across unmerged parts.
  //
  // Two materialized views populate this table from the source tables.
  // The WHERE clause caps the MV to ledgers > the cutoff used during
  // backfill — historical data is loaded by a one-shot INSERT...SELECT
  // covering ledgers <= cutoff. Backfill + MV split deterministically
  // by ledger_index to avoid double-counting.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.account_tx_counts (
      account            String,
      sent_count         SimpleAggregateFunction(sum, UInt64),
      received_count     SimpleAggregateFunction(sum, UInt64),
      first_seen_ledger  SimpleAggregateFunction(min, UInt32),
      last_seen_ledger   SimpleAggregateFunction(max, UInt32)
    )
    ENGINE = AggregatingMergeTree
    PARTITION BY tuple()
    ORDER BY account
    SETTINGS index_granularity = 8192`,
    "table: account_tx_counts",
  );

  // The MV cutoff (104120000) was set during the live migration on
  // 2026-05-09 — see `docs/CHANGELOG.md`. For fresh setups (smoketest,
  // local dev), cutoff = 0 so MVs catch every insert from the start.
  // Production keeps the historical cutoff because backfill loaded
  // pre-cutoff data already.
  const MV_LEDGER_CUTOFF =
    DATABASE === "sonde" ? 104120000 : 0;
  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_account_tx_counts_sent
     TO ${DATABASE}.account_tx_counts AS
     SELECT
       account,
       toUInt64(count())              AS sent_count,
       toUInt64(0)                    AS received_count,
       toUInt32(min(ledger_index))    AS first_seen_ledger,
       toUInt32(max(ledger_index))    AS last_seen_ledger
     FROM ${DATABASE}.transactions
     WHERE ledger_index > ${MV_LEDGER_CUTOFF}
     GROUP BY account`,
    "view: mv_account_tx_counts_sent",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_account_tx_counts_received
     TO ${DATABASE}.account_tx_counts AS
     SELECT
       to_account                     AS account,
       toUInt64(0)                    AS sent_count,
       toUInt64(count())              AS received_count,
       toUInt32(min(ledger_index))    AS first_seen_ledger,
       toUInt32(max(ledger_index))    AS last_seen_ledger
     FROM ${DATABASE}.value_transfer_events
     WHERE ledger_index > ${MV_LEDGER_CUTOFF}
     GROUP BY to_account`,
    "view: mv_account_tx_counts_received",
  );

  // ── Portfolio snapshots (PG → CH migration, Phase 3) ─────────────
  // Time-series of per-account portfolio value. Migrated from PG
  // `portfolio_snapshots` (34 MB) on 2026-05-09. Monthly partitions
  // mean retention is a `DROP PARTITION` away — replaces the stepped
  // `compactOnce` DELETE queries the PG version had.
  //
  // `token_breakdown` is the JSON blob produced by the snapshot writer
  // (one entry per held IOU token with USD value). Stored as String
  // here; consumers JSON.parse it.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.portfolio_snapshots (
      snapshot_time       DateTime,
      address             String,
      xrp_balance         Float64 DEFAULT 0,
      xrp_price_usd       Float64 DEFAULT 0,
      token_value_usd     Float64 DEFAULT 0,
      amm_value_usd       Float64 DEFAULT 0,
      locked_xrp          Float64 DEFAULT 0,
      total_value_usd     Float64 DEFAULT 0,
      nft_count           UInt32  DEFAULT 0,
      owner_count         UInt32  DEFAULT 0,
      token_breakdown     String  DEFAULT ''
    )
    ENGINE = MergeTree
    PARTITION BY toYYYYMM(snapshot_time)
    ORDER BY (address, snapshot_time)
    SETTINGS index_granularity = 8192`,
    "table: portfolio_snapshots",
  );

  // ── Token volume hourly with OHLC ──────────────────────────────────
  // AggregatingMergeTree because OHLC needs argMin/argMax-style "first/last"
  // aggregates. Query with argMinMerge(open_price), argMaxMerge(close_price).
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_token_volume_hourly (
      hour              DateTime,
      base_currency     LowCardinality(String),
      base_issuer       String,
      quote_currency    LowCardinality(String),
      quote_issuer      String,
      trade_count       UInt64,
      base_volume       Float64,
      quote_volume      Float64,
      xrp_volume_drops  Int64,
      open_price        AggregateFunction(argMin, Float64, DateTime),
      close_price       AggregateFunction(argMax, Float64, DateTime),
      high_price        SimpleAggregateFunction(max, Float64),
      low_price         SimpleAggregateFunction(min, Float64)
    )
    ENGINE = AggregatingMergeTree()
    PARTITION BY toYYYYMM(hour)
    ORDER BY (hour, base_currency, base_issuer, quote_currency, quote_issuer)`,
    "table: mv_token_volume_hourly (target)",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_token_volume_hourly_view
    TO ${DATABASE}.mv_token_volume_hourly AS
    SELECT
      toStartOfHour(timestamp) AS hour,
      base_currency,
      base_issuer,
      quote_currency,
      quote_issuer,
      count() AS trade_count,
      sum(base_amount) AS base_volume,
      sum(quote_amount) AS quote_volume,
      sum(xrp_volume_drops) AS xrp_volume_drops,
      argMinState(price, timestamp) AS open_price,
      argMaxState(price, timestamp) AS close_price,
      max(price) AS high_price,
      min(price) AS low_price
    FROM ${DATABASE}.dex_trades
    GROUP BY hour, base_currency, base_issuer, quote_currency, quote_issuer`,
    "materialized view: token_volume_hourly",
  );

  // ── Fee burn hourly (replaces PG fee_burn_hourly) ──────────────────
  // mv_hourly_tx_volume groups by tx_type; this one is type-agnostic for
  // the fee-burn timeseries that the burn page uses.
  // INTENTIONALLY counts ALL results (no tesSUCCESS filter). XRPL burns
  // the transaction fee on tec/tef/tem/tel-class failures too — those
  // burned fees are real and contribute to the network's deflationary
  // pressure. Filtering them out would underreport actual XRPL burn.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_fee_burn_hourly (
      hour              DateTime,
      tx_count          UInt64,
      total_burn_drops  Int64
    )
    ENGINE = SummingMergeTree()
    PARTITION BY toYYYYMM(hour)
    ORDER BY hour`,
    "table: mv_fee_burn_hourly (target)",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_fee_burn_hourly_view
    TO ${DATABASE}.mv_fee_burn_hourly AS
    SELECT
      toStartOfHour(timestamp) AS hour,
      count() AS tx_count,
      sum(fee_drops) AS total_burn_drops
    FROM ${DATABASE}.transactions
    GROUP BY hour`,
    "materialized view: fee_burn_hourly",
  );

  // ── Payment corridors ──────────────────────────────────────────────
  // One row per qualifying Payment tx (XRP on at least one side). Source
  // for hourly/daily MVs that drive the corridors page.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.payment_corridors (
      tx_hash           FixedString(64),
      ledger_index      UInt32,
      timestamp         DateTime,
      src_currency      LowCardinality(String),
      src_issuer        String DEFAULT '',
      dst_currency      LowCardinality(String),
      dst_issuer        String DEFAULT '',
      xrp_volume_drops  Int64 DEFAULT 0
    )
    ENGINE = ReplacingMergeTree()
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (tx_hash)
    SETTINGS index_granularity = 8192`,
    "table: payment_corridors",
  );

  // Hourly corridor aggregates
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_payment_corridor_hourly (
      hour              DateTime,
      src_currency      LowCardinality(String),
      src_issuer        String,
      dst_currency      LowCardinality(String),
      dst_issuer        String,
      count             UInt64,
      xrp_volume_drops  Int64
    )
    ENGINE = SummingMergeTree()
    PARTITION BY toYYYYMM(hour)
    ORDER BY (hour, src_currency, src_issuer, dst_currency, dst_issuer)`,
    "table: mv_payment_corridor_hourly (target)",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_payment_corridor_hourly_view
    TO ${DATABASE}.mv_payment_corridor_hourly AS
    SELECT
      toStartOfHour(timestamp) AS hour,
      src_currency,
      src_issuer,
      dst_currency,
      dst_issuer,
      count() AS count,
      sum(xrp_volume_drops) AS xrp_volume_drops
    FROM ${DATABASE}.payment_corridors
    GROUP BY hour, src_currency, src_issuer, dst_currency, dst_issuer`,
    "materialized view: payment_corridor_hourly",
  );

  // Daily corridor aggregates
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_payment_corridor_daily (
      day               Date,
      src_currency      LowCardinality(String),
      src_issuer        String,
      dst_currency      LowCardinality(String),
      dst_issuer        String,
      count             UInt64,
      xrp_volume_drops  Int64
    )
    ENGINE = SummingMergeTree()
    PARTITION BY toYYYYMM(day)
    ORDER BY (day, src_currency, src_issuer, dst_currency, dst_issuer)`,
    "table: mv_payment_corridor_daily (target)",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_payment_corridor_daily_view
    TO ${DATABASE}.mv_payment_corridor_daily AS
    SELECT
      toDate(timestamp) AS day,
      src_currency,
      src_issuer,
      dst_currency,
      dst_issuer,
      count() AS count,
      sum(xrp_volume_drops) AS xrp_volume_drops
    FROM ${DATABASE}.payment_corridors
    GROUP BY day, src_currency, src_issuer, dst_currency, dst_issuer`,
    "materialized view: payment_corridor_daily",
  );

  // ── Wallet trade volume hourly ─────────────────────────────────────
  // Two MVs feeding the same target table — one per side (taker, maker).
  // CH SummingMergeTree adds the rows on merge, so a wallet that's on
  // both sides of different trades in the same hour gets the combined
  // total. Buy/sell directionality is intentionally collapsed here;
  // restore via taker_side column once that lands (deferred follow-up).
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_wallet_trade_volume_hourly (
      hour              DateTime,
      wallet            String,
      trade_count       UInt64,
      xrp_volume_drops  Int64
    )
    ENGINE = SummingMergeTree()
    PARTITION BY toYYYYMM(hour)
    ORDER BY (hour, wallet)`,
    "table: mv_wallet_trade_volume_hourly (target)",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_wallet_trade_volume_hourly_taker_view
    TO ${DATABASE}.mv_wallet_trade_volume_hourly AS
    SELECT
      toStartOfHour(timestamp) AS hour,
      taker AS wallet,
      count() AS trade_count,
      sum(xrp_volume_drops) AS xrp_volume_drops
    FROM ${DATABASE}.dex_trades
    WHERE taker != ''
    GROUP BY hour, wallet`,
    "materialized view: wallet_trade_volume_hourly (taker side)",
  );

  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_wallet_trade_volume_hourly_maker_view
    TO ${DATABASE}.mv_wallet_trade_volume_hourly AS
    SELECT
      toStartOfHour(timestamp) AS hour,
      maker AS wallet,
      count() AS trade_count,
      sum(xrp_volume_drops) AS xrp_volume_drops
    FROM ${DATABASE}.dex_trades
    WHERE maker != ''
    GROUP BY hour, wallet`,
    "materialized view: wallet_trade_volume_hourly (maker side)",
  );

  // ── Account counterparty daily (Neo4j-replacement, 2026-04-30) ─────
  // Powers the queries that used to live in Neo4j: who has account X
  // interacted with, how many times, when. Replaces the PAYMENT and
  // DEX_TRADE counterparty cypher in /api/intel/profile, counterparties,
  // overview, watchlist-status.
  //
  // Storage shape: one row per (account, counterparty, day). For each
  // source event we emit TWO rows — one from each side's perspective —
  // so a downstream query "counterparties of X" is a partition-pruned
  // `WHERE account = X` scan rather than a `WHERE from = X OR to = X`
  // table scan.
  //
  // Mirrors the existing `mv_wallet_trade_volume_hourly` two-side
  // pattern for consistency. Four MVs total (2 per source table).
  //
  // Note: MVs only trigger on NEW inserts after creation. Historical
  // data must be backfilled with `INSERT INTO ... SELECT` after this
  // setup runs — see scripts/backfill-counterparty-mv.ts (TODO).
  // `last_ts` uses SimpleAggregateFunction(max, DateTime) so the
  // SummingMergeTree merges it via max() rather than summing.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.mv_account_counterparty_daily (
      account         String,
      counterparty    String,
      day             Date,
      tx_count        UInt64,
      payment_count   UInt64,
      dex_count       UInt64,
      last_ts         SimpleAggregateFunction(max, DateTime)
    )
    ENGINE = SummingMergeTree()
    PARTITION BY toYYYYMM(day)
    ORDER BY (account, counterparty, day)
    SETTINGS index_granularity = 8192`,
    "table: mv_account_counterparty_daily (target)",
  );

  // From-side: emits row keyed on the sender, counterparty = recipient
  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_account_counterparty_daily_vte_from_view
    TO ${DATABASE}.mv_account_counterparty_daily AS
    SELECT
      from_account      AS account,
      to_account        AS counterparty,
      toDate(timestamp) AS day,
      count()           AS tx_count,
      count()           AS payment_count,
      toUInt64(0)       AS dex_count,
      max(timestamp)    AS last_ts
    FROM ${DATABASE}.value_transfer_events
    WHERE from_account != '' AND to_account != ''
    GROUP BY account, counterparty, day`,
    "materialized view: account_counterparty_daily (vte from-side)",
  );

  // To-side: emits row keyed on the recipient, counterparty = sender
  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_account_counterparty_daily_vte_to_view
    TO ${DATABASE}.mv_account_counterparty_daily AS
    SELECT
      to_account        AS account,
      from_account      AS counterparty,
      toDate(timestamp) AS day,
      count()           AS tx_count,
      count()           AS payment_count,
      toUInt64(0)       AS dex_count,
      max(timestamp)    AS last_ts
    FROM ${DATABASE}.value_transfer_events
    WHERE from_account != '' AND to_account != ''
    GROUP BY account, counterparty, day`,
    "materialized view: account_counterparty_daily (vte to-side)",
  );

  // Taker-side of dex_trades
  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_account_counterparty_daily_dex_taker_view
    TO ${DATABASE}.mv_account_counterparty_daily AS
    SELECT
      taker             AS account,
      maker             AS counterparty,
      toDate(timestamp) AS day,
      count()           AS tx_count,
      toUInt64(0)       AS payment_count,
      count()           AS dex_count,
      max(timestamp)    AS last_ts
    FROM ${DATABASE}.dex_trades
    WHERE taker != '' AND maker != ''
    GROUP BY account, counterparty, day`,
    "materialized view: account_counterparty_daily (dex taker-side)",
  );

  // Maker-side of dex_trades
  await run(
    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.mv_account_counterparty_daily_dex_maker_view
    TO ${DATABASE}.mv_account_counterparty_daily AS
    SELECT
      maker             AS account,
      taker             AS counterparty,
      toDate(timestamp) AS day,
      count()           AS tx_count,
      toUInt64(0)       AS payment_count,
      count()           AS dex_count,
      max(timestamp)    AS last_ts
    FROM ${DATABASE}.dex_trades
    WHERE taker != '' AND maker != ''
    GROUP BY account, counterparty, day`,
    "materialized view: account_counterparty_daily (dex maker-side)",
  );

  // ── Indexes on transactions ──────────────────────────────────────
  // Idempotent via `IF NOT EXISTS`. New writes auto-populate the bloom
  // filter; the historical backlog is materialized by the slice-1
  // migration script (`scripts/migrate-account-page-foundations.ts`),
  // not this setup script — rewriting parts on a 631M-row table is a
  // multi-hour job that doesn't belong in the deploy path.
  //
  // No `proj_destination` here intentionally: received-by queries route
  // through `value_transfer_events` (already ordered by `to_account`)
  // and AffectedNodes-only relationships through the new
  // `account_tx_index` table — see docs/plans/db-first-page-loads.md
  // for the synthesis-first architecture decision.

  // bloom_filter on tx_hash — speeds up `WHERE tx_hash = X` lookups
  // (the /tx/[hash] page) from a partition-spanning scan to a
  // bloom-skip + small region scan. The PK is `(account, timestamp,
  // tx_hash)` so without this index, single-hash lookups read every
  // partition. GRANULARITY 4 = one bloom per 4 granules (~32K rows).
  //
  // Note: tx_hash is unique per row, so GRANULARITY 1 vs 4 is roughly
  // a wash here — Tier 1.5 Suggestion #13's "higher granularity for
  // high-cardinality" advice is for *repeating* high-cardinality
  // columns like `taker`/`maker` where bloom crowding is a real
  // concern. EXPLAIN on a 637M-row synthetic-hash lookup showed
  // 8341/347693 granules scanned (~2.4%) at GRANULARITY 4; GRANULARITY 1
  // would be marginally sharper but the practical difference is within
  // noise. Kept at 4 to match what shipped on prod 2026-05-04.
  await run(
    `ALTER TABLE ${DATABASE}.transactions
       ADD INDEX IF NOT EXISTS idx_tx_hash tx_hash TYPE bloom_filter GRANULARITY 4`,
    "index: idx_tx_hash (bloom_filter on tx_hash)",
  );

  // ── account_tx_index ─────────────────────────────────────────────
  // Per-account inverted index for tx history. Solves the AffectedNodes
  // coverage gap: txs that affect an account through metadata (offer
  // crossed, AMM LP shares moved, trustline peer balance changed,
  // AccountRoot modified by a side effect) without the account being
  // the sender or destination.
  //
  // One row per (account, tx) where the account is touched in any role
  // OTHER than direct sender. Sender coverage already comes from the
  // `transactions` PK. Receiver coverage from `value_transfer_events`.
  // This index is the AffectedNodes-only delta plus explicit Destination
  // for non-value-transfer tx types (EscrowCreate, NFTokenAcceptOffer,
  // etc. that have a Destination but aren't payments) — NOT a full
  // mirror.
  //
  // role values:
  //   - destination            their address is in the tx Destination
  //                            field but it's not a value transfer
  //                            (rare; covers escrow/check/NFT-accept)
  //   - offer_owner            their offer was modified/deleted (crossed)
  //   - amm_lp                 their LP RippleState with an AMM moved
  //   - trustline_peer         RippleState peer side modified (non-AMM)
  //   - account_root_modified  AccountRoot changed by a tx where they're
  //                            not Account / Destination
  //
  // ORDER BY puts `account` first so per-account lookups are partition-
  // pruned + range-scanned. `role` is in the dedup key so a single
  // account in multiple roles for the same tx survives ReplacingMergeTree.
  // No Float64 in ORDER BY (Tier 1.5 C2 lesson).
  //
  // Empty until slice 5 wires the ingester walk + backfills the historical
  // window from `transactions.meta_json`.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.account_tx_index (
      account       String,
      timestamp     DateTime,
      tx_hash       FixedString(64),
      ledger_index  UInt32,
      tx_type       LowCardinality(String),
      role          LowCardinality(String)
    )
    ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (account, timestamp, tx_hash, role)
    SETTINGS index_granularity = 8192`,
    "table: account_tx_index",
  );

  // ---------------------------------------------------------------
  // nft_collection_daily_snapshots
  // ---------------------------------------------------------------
  //
  // Per-collection, per-day metric snapshot powering the collection
  // detail page's time-series charts (floor over time, listing count,
  // unique-holder count, daily volume). Written by
  // `scripts/run-collection-daily-snapshot.ts` on a daily Hetzner
  // systemd timer.
  //
  // Floor / listings / holder counts can't be derived from event
  // history retroactively — they're STATE that has to be sampled at
  // intervals. Volume + trade-count can technically come from
  // `nft_trades` aggregation, but storing them here too lets the
  // chart query read one row per day per collection instead of a
  // JOIN against a wider table.
  //
  // ReplacingMergeTree(snapshot_time): re-runs on the same day
  // overwrite the prior row for (issuer, taxon, day). Useful for
  // backfilling missed days or fixing bad snapshots without
  // duplicating rows.
  //
  // Empty floor / listings / holder counts default to 0 — read
  // consumers should treat 0 as "no data" when the day predates the
  // first snapshot run.
  await run(
    `CREATE TABLE IF NOT EXISTS ${DATABASE}.nft_collection_daily_snapshots (
      issuer            String,
      taxon             UInt32,
      day               Date,
      floor_drops       UInt64 DEFAULT 0,
      listing_count     UInt32 DEFAULT 0,
      holder_count      UInt32 DEFAULT 0,
      volume_24h_drops  UInt64 DEFAULT 0,
      trade_count_24h   UInt32 DEFAULT 0,
      snapshot_time     DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(snapshot_time)
    PARTITION BY toYYYYMM(day)
    ORDER BY (issuer, taxon, day)
    SETTINGS index_granularity = 8192`,
    "table: nft_collection_daily_snapshots",
  );

  console.log("\nClickHouse setup complete.");
  await client.close();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
