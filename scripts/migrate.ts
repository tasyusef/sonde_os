/**
 * Master migration runner — runs every idempotent schema migration in order.
 *
 * This script is invoked on every deploy as part of the start command so that
 * new schema changes go live in prod BEFORE the code that depends on them.
 * It replaces the "remember to run the migration script before deploying"
 * dance that bit us on 2026-04-09 (see git log).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULES FOR ADDING A NEW MIGRATION (read this before editing)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. **Idempotent or bust.** Every migration must be safe to run dozens of
 *    times without breaking anything. Use `ADD COLUMN IF NOT EXISTS`,
 *    `CREATE INDEX IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`. For data
 *    migrations, use `WHERE` clauses that skip already-migrated rows.
 *
 * 2. **Schema migrations only.** Heavy data migrations (rewriting millions
 *    of rows, one-off backfills) should NOT go here — they belong in a
 *    separate one-off script that you run manually. This file runs on
 *    every deploy; you don't want a 10-minute data rewrite in your cold
 *    start path.
 *
 * 3. **Append, never reorder.** Once a migration has shipped to prod, do
 *    not reorder or rename it. Append new migrations to the END of the
 *    MIGRATIONS array.
 *
 * 4. **Small and focused.** One logical change per migration. If you need
 *    to add 3 columns, that's 3 separate entries. Easier to debug when
 *    something fails.
 *
 * 5. **Test locally first.** Before committing, run:
 *      NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate.ts
 *    against a local DB, verify the schema matches what you expect.
 *
 * 6. **Keep individual files for history.** Existing migrate-*.ts files
 *    stay as historical reference. New migrations should be added here
 *    directly — not as new standalone scripts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[migrate] DATABASE_URL required");
  process.exit(1);
}

// Single connection for all migrations.
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

interface Migration {
  /** Stable name, used for logging. Do not change after shipping. */
  name: string;
  /** Idempotent migration body. Throws on failure. */
  run: () => Promise<void>;
}

/**
 * Ordered list of migrations. APPEND NEW ENTRIES TO THE END.
 * Each migration must be idempotent — safe to re-run on every deploy.
 */
const MIGRATIONS: Migration[] = [
  {
    name: "add_ai_usage_model_column",
    run: async () => {
      await sql`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS model VARCHAR(50)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_ai_usage_model ON ai_usage (model)`;
    },
  },
  {
    name: "normalize_legacy_pro_ai_subscriptions",
    run: async () => {
      // Converts any legacy pro_ai subscription rows to pro. Idempotent: the
      // WHERE clause ensures repeat runs do nothing once the data is clean.
      await sql`UPDATE subscriptions SET tier = 'pro' WHERE tier = 'pro_ai'`;
    },
  },
  {
    name: "add_amm_pools_tvl_columns",
    run: async () => {
      // Cached TVL snapshot so getTopAMMPools() can read from DB instead of
      // fanning out to amm_info for every pool. Populated by the
      // AmmPoolTvlRefresher background manager. See docs/wiki if extending.
      await sql`ALTER TABLE amm_pools ADD COLUMN IF NOT EXISTS tvl_xrp NUMERIC(30, 6)`;
      await sql`ALTER TABLE amm_pools ADD COLUMN IF NOT EXISTS tvl_updated_at TIMESTAMPTZ`;
      await sql`CREATE INDEX IF NOT EXISTS idx_amm_pools_tvl ON amm_pools (tvl_xrp DESC NULLS LAST)`;
    },
  },
  {
    name: "create_nft_metadata_cache",
    run: async () => {
      // Per-NFT resolved metadata cache. Populated lazily by the
      // metadata resolver (on first read) and proactively by the trade
      // ingestion pipeline (when URI becomes known via nft_info).
      // fetch_status is "ok" when name/image resolved, "failed" when
      // all gateways errored (retry after a cooldown window), "pending"
      // when we only know the URI but haven't resolved the JSON yet.
      await sql`
        CREATE TABLE IF NOT EXISTS nft_metadata (
          nftoken_id       VARCHAR(64) PRIMARY KEY,
          issuer           VARCHAR(35) NOT NULL,
          taxon            BIGINT NOT NULL,
          uri              TEXT,
          name             TEXT,
          image_url        TEXT,
          description      TEXT,
          attributes       JSONB,
          fetched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          fetch_status     VARCHAR(16) NOT NULL DEFAULT 'pending',
          fetch_attempts   INTEGER NOT NULL DEFAULT 0
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_nft_metadata_issuer_taxon ON nft_metadata (issuer, taxon)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_nft_metadata_fetch_status ON nft_metadata (fetch_status, fetched_at)`;
    },
  },
  {
    name: "create_nft_collections_cache",
    run: async () => {
      // Per-(issuer, taxon) collection cache. Name is derived from a
      // representative NFT's metadata (trailing #N stripped). The
      // representative NFT id is recorded so we can re-resolve if the
      // original goes stale / is burned.
      await sql`
        CREATE TABLE IF NOT EXISTS nft_collections (
          issuer                    VARCHAR(35) NOT NULL,
          taxon                     BIGINT NOT NULL,
          name                      TEXT,
          image_url                 TEXT,
          representative_nftoken_id VARCHAR(64),
          fetched_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          fetch_status              VARCHAR(16) NOT NULL DEFAULT 'pending',
          PRIMARY KEY (issuer, taxon)
        )
      `;
    },
  },
  {
    name: "create_job_state_table",
    run: async () => {
      // Scheduling + locking table for background managers (LabelManager,
      // AlertEngine, etc.). Was previously a separate manual migration
      // (`scripts/migrate-job-state.ts`) which caused silent startup
      // failures when the table wasn't created on fresh deploys.
      await sql`
        CREATE TABLE IF NOT EXISTS job_state (
          job_name VARCHAR(50) PRIMARY KEY,
          status VARCHAR(20) NOT NULL DEFAULT 'idle',
          last_run_at TIMESTAMPTZ,
          next_run_at TIMESTAMPTZ,
          locked_until TIMESTAMPTZ,
          run_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          state_json JSONB,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    },
  },
  {
    name: "add_missing_timeseries_indexes_2026_04_22",
    run: async () => {
      // Backend audit (2026-04-22) identified missing indexes on pair and
      // corridor filters. Queries that filtered by destination pair or
      // corridor direction were full-scanning.
      //
      // 2026-05-09: 5 of the 6 indexes targeted PG aggregation tables that
      // were dropped in Phase 4 of the PG → CH migration
      // (token_volume_*, payment_corridor_*, nft_volume_*). Without
      // guards, CREATE INDEX on a missing table errors and aborts the
      // whole migrate run on every deploy. The DO/IF EXISTS wrappers
      // make each create a no-op when the underlying table is gone —
      // keeps the migration entry idempotent across pre- and post-drop
      // schemas without violating the append-never-edit rule.
      await sql`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'token_volume_hourly') THEN
          CREATE INDEX IF NOT EXISTS idx_token_vol_hourly_pair ON token_volume_hourly (pair_currency, pair_issuer);
        END IF;
      END $$`;
      await sql`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'token_volume_daily') THEN
          CREATE INDEX IF NOT EXISTS idx_token_vol_daily_pair ON token_volume_daily (pair_currency, pair_issuer);
        END IF;
      END $$`;
      await sql`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_corridor_daily') THEN
          CREATE INDEX IF NOT EXISTS idx_corridor_daily_src ON payment_corridor_daily (src_currency, src_issuer);
          CREATE INDEX IF NOT EXISTS idx_corridor_daily_dst ON payment_corridor_daily (dst_currency, dst_issuer);
        END IF;
      END $$`;
      await sql`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nft_volume_daily') THEN
          CREATE INDEX IF NOT EXISTS idx_nft_vol_daily_marketplace ON nft_volume_daily (marketplace);
        END IF;
      END $$`;
      await sql`CREATE INDEX IF NOT EXISTS idx_tracked_accounts_created ON tracked_accounts (created_at)`;
    },
  },
  {
    name: "add_token_metadata_latest_price",
    run: async () => {
      // Persistent price per token — populated by TokenPriceRefresher from
      // ClickHouse dex_trades. Lets /markets render prices and market caps
      // on the server instead of stalling on 2,400+ per-row book_offers
      // calls from the browser.
      await sql`ALTER TABLE token_metadata ADD COLUMN IF NOT EXISTS latest_price NUMERIC`;
      await sql`ALTER TABLE token_metadata ADD COLUMN IF NOT EXISTS latest_price_at TIMESTAMPTZ`;
    },
  },
  {
    name: "create_account_tx_counts",
    run: async () => {
      // Per-account lifetime tx counters were here pre-2026-05-09. The
      // counter is now an `AggregatingMergeTree` in CH, populated by
      // two MVs from `transactions` and `value_transfer_events` (Phase
      // 2 of PG → CH migration). The PG table itself is dropping in
      // 48h after parity verification — this migration body is a no-op
      // so it doesn't resurrect an empty husk on the next deploy after
      // the drop. Migration name kept for log continuity.
    },
  },
  {
    // Phase 2 backfill — gap log for `lgrNotFound` errors against xrplcluster.
    // Backfill worker inserts a row each time it can't fetch a ledger,
    // advances pointer, and continues. Resolved later via different rippled
    // endpoint or self-hosted archival node. See docs/runbooks/phase-2-backfill.md.
    name: "phase2_backfill_gaps_table",
    run: async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS backfill_gaps (
          ledger_index BIGINT PRIMARY KEY,
          reason       TEXT NOT NULL,
          attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          resolved_at  TIMESTAMPTZ
        )
      `;
      // Useful for quickly counting unresolved gaps in the daily monitoring loop.
      await sql`CREATE INDEX IF NOT EXISTS idx_backfill_gaps_unresolved ON backfill_gaps (resolved_at) WHERE resolved_at IS NULL`;
    },
  },
  {
    name: "drop_investigation_tables",
    run: async () => {
      // 2026-05-01 — investigate feature retired alongside the Neo4j cut.
      // The route's tools (trace_funds, find_connections) were tightly
      // Cypher-coupled and weren't worth rebuilding on CH for a feature
      // with negligible engagement. See docs/plans/neo4j-removal.md.
      // CASCADE drops the FK from investigation_messages to
      // investigation_sessions; without it the second DROP would fail
      // on the dependency. IF EXISTS makes both ops idempotent.
      await sql`DROP TABLE IF EXISTS investigation_messages CASCADE`;
      await sql`DROP TABLE IF EXISTS investigation_sessions CASCADE`;
    },
  },
  {
    name: "create_asktheledger_history",
    run: async () => {
      // Per-Pro-user history of /asktheledger questions + structured
      // responses. Powers the "Recent" rail above the chat empty state.
      // JSONB columns store the visualization / stat / table payloads
      // exactly as they were rendered, so reopening a past answer is
      // instant and matches what the user originally saw.
      await sql`
        CREATE TABLE IF NOT EXISTS asktheledger_history (
          id            BIGSERIAL PRIMARY KEY,
          user_address  VARCHAR(35) NOT NULL,
          question      TEXT NOT NULL,
          answer        TEXT NOT NULL,
          store         VARCHAR(16),
          query         TEXT,
          visualization JSONB,
          stat_value    JSONB,
          table_data    JSONB,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_asktheledger_history_user ON asktheledger_history (user_address, created_at DESC)`;
    },
  },
  {
    name: "page_views_referrer_host",
    run: async () => {
      // Capture the hostname of the HTTP Referer for each page view.
      // Null for direct visits, internal navigation, or browsers that
      // strip the header (Referrer-Policy: no-referrer / strict-origin
      // when crossing origins). Lets the admin dashboard answer "where
      // did this traffic spike come from" without grepping access logs.
      await sql`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS referrer_host VARCHAR(100)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_page_views_referrer_time ON page_views (referrer_host, timestamp)`;
    },
  },
  {
    name: "smart_money_scores_seasoning_score",
    run: async () => {
      // Wallet seasoning factor: log10(age_days) × log10(distinct_counterparties),
      // scaled to 0-100. Hard-to-fake signal that complements the existing
      // PnL-derived factors. Null for rows scored before this column was
      // added; the next scorer run populates it.
      await sql`ALTER TABLE smart_money_scores ADD COLUMN IF NOT EXISTS seasoning_score NUMERIC(5,2)`;
    },
  },
  {
    name: "nft_metadata_collection_name",
    run: async () => {
      // Capture the JSON metadata's `collection` (or `collection_name`)
      // field at fetch time so we don't have to infer collection names
      // from per-NFT titles. Many collections (faker-style person names,
      // unique fantasy descriptors) have no consistent "{name} #{N}"
      // pattern, so consensus-on-names returns null and the UI falls
      // through to "Collection #{taxon}". When the JSON carries an
      // explicit collection name, this column lets us use it directly.
      //
      // Only the schema change runs in the deploy path. Existing rows
      // populate `collection_name` as users browse and the resolver
      // refetches naturally; for explicit one-shot population (e.g.,
      // after the column is added), use `scripts/refresh-nft-metadata.ts`
      // to mark a slice of rows as `pending`.
      await sql`ALTER TABLE nft_metadata ADD COLUMN IF NOT EXISTS collection_name TEXT`;
    },
  },
  {
    name: "nft_collections_source_column",
    run: async () => {
      // Track which resolver layer produced the cached name so we can
      // reason about coverage + invalidate by layer when one improves.
      // Values: "json" (NFT metadata's `collection` field via consensus
      // across the collection), "toml" (issuer's xrp-ledger.toml
      // [[NFTS]] entry), "consensus" (per-NFT name pattern fallback),
      // or null when not yet resolved. See `lib/nft-collection-resolver.ts`.
      await sql`ALTER TABLE nft_collections ADD COLUMN IF NOT EXISTS source VARCHAR(16)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_nft_collections_resolved ON nft_collections (issuer, taxon) WHERE name IS NOT NULL`;
    },
  },
];

async function main() {
  console.log(`[migrate] running ${MIGRATIONS.length} migration(s)...`);
  const startAll = Date.now();

  for (const migration of MIGRATIONS) {
    const start = Date.now();
    try {
      await migration.run();
      const elapsed = Date.now() - start;
      console.log(`[migrate] ✓ ${migration.name} (${elapsed}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[migrate] ✗ ${migration.name} FAILED: ${msg}`);
      await sql.end();
      process.exit(1);
    }
  }

  const totalElapsed = Date.now() - startAll;
  console.log(`[migrate] complete (${totalElapsed}ms)`);
  await sql.end();
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
