/**
 * Plain-English descriptions of every table and materialized view in
 * ClickHouse. Used as context for the LLM query router so it can
 * generate correct SQL.
 *
 * ⚠️ KEEP IN SYNC WITH:
 *   - scripts/setup-clickhouse.ts (ClickHouse tables + materialized views)
 *   - src/lib/intel-ingestion.ts (what actually gets written)
 *
 * If you add a new table that the AI should be able to query, document
 * it here. If you document something that isn't actually written by the
 * ingestion pipeline, users will get silent failures.
 *
 * Pre-2026-04-30 the router could also target Neo4j; that store was
 * removed alongside the Neo4j cut and CH is now the only target. See
 * `docs/plans/neo4j-removal.md`.
 */

export const STORE_DESCRIPTIONS = `
## Data Store

You have access to a single ClickHouse data store. Generate SQL that answers the user's XRPL question against the schema below.

### ClickHouse (time-series + relationship analytics)
SQL dialect. Best for: aggregations, trends, volume queries, "how many", "top N", "over time", trustline counts, wallet PnL rankings, payment-flow questions, counterparty lookups.

**Table: transactions**
Raw XRPL transactions. One row per transaction (successful + failed; filter by result for success-only).
Columns:
- tx_hash (FixedString(64)) — transaction hash
- tx_type (LowCardinality(String)) — e.g. Payment, OfferCreate, TrustSet, NFTokenAcceptOffer
- account (String) — sender address (r-address)
- destination (String) — recipient address (empty for non-payment types)
- amount_drops (Int64) — XRP amount in drops; 0 for IOU rows. NOTE: query this only when currency='XRP'.
- amount_iou (String) — IOU amount as JSON {"currency":"...","issuer":"...","value":"..."}; "" for XRP rows. Use JSONExtract(amount_iou, 'value', 'String') to read the value as text. Lossless precision (XRPL IOU values can have 16 sig digits).
- currency (LowCardinality(String)) — "XRP" or 3-char/hex currency code
- issuer (String) — issuer address for IOUs, empty for XRP
- fee_drops (UInt32) — transaction fee in drops (always burned, even on failures)
- timestamp (DateTime) — transaction time (UTC)
- ledger_index (UInt32) — ledger sequence number
- result (LowCardinality(String)) — XRPL result code. 'tesSUCCESS' = succeeded; 'tec*' / 'tef*' / 'tem*' / 'tel*' = various failure classes (still wrote to ledger and burned fee)
- memo (String) — decoded memo text (first memo entry, max 500 chars)
- memo_type (LowCardinality(String)) — first memo's MemoType (e.g. 'client', 'label')
- memo_format (LowCardinality(String)) — first memo's MemoFormat (e.g. 'text/plain', 'application/json')
- delivered_amount_drops (Int64) — Payments: actual delivered XRP drops (post-pathfinding); 0 for IOU/non-Payment
- delivered_amount_iou (String) — Payments: actual delivered IOU as JSON; "" for XRP/non-Payment
- tx_json (String, ZSTD) — full original transaction JSON
- meta_json (String, ZSTD) — full transaction metadata JSON (AffectedNodes, etc.)
- nftoken_id (FixedString(64)) — NFToken ID if applicable, '0'*64 otherwise
- flags (UInt32) — XRPL transaction flags bitmap (tfPartialPayment = 0x00020000, etc.)
- sequence (UInt32) — sender's account sequence number for this tx
- source_tag, destination_tag (UInt32) — optional 32-bit tags for exchange/destination identification
- last_ledger_sequence (UInt32) — XRPL LastLedgerSequence; the highest ledger this tx was allowed to be included in. 0 if absent. Useful for time-to-live / abandoned-tx analysis.
- ticket_sequence (UInt32) — non-zero when the sender used a ticket instead of incrementing Account.Sequence. 0 means a normal sequence-based tx.
- signing_pub_key (String) — pubkey that signed the tx. Empty for multisig (signers are inside the SignerListSet / Signers array, accessible via tx_json).
- network_id (UInt32) — XRPL network identifier; 0 on mainnet, non-zero on sidechains/devnet.

**Tx-shape notes accessible via \`tx_json\` (not stored as columns):**
- \`DeliverMax\` is the modern alias for \`Amount\` on Payment txs. Both fields carry the maximum the sender is willing to deliver; rippled uses whichever is present. Older transactions only have \`Amount\`; newer ones may carry both. For the actual delivered value, use \`delivered_amount_drops\` / \`delivered_amount_iou\` (they're populated from \`meta.delivered_amount\` post-pathfinding).
- \`Paths\` is a path-finding hint array on cross-currency Payments. It's the suggested route through the order book / AMM pools but rippled may pick a different path; presence of \`Paths\` is a signal that the Payment is cross-currency (or the sender expected it to be). Useful for filtering: \`JSONExtract(tx_json, 'Paths', 'String') != ''\` distinguishes path-finding Payments from same-currency direct Payments.

Partitioned by toYYYYMM(timestamp), ordered by (account, timestamp, tx_hash). Skip index idx_ledger_index (minmax on ledger_index) helps SOME ledger-range scans but its effectiveness is limited because the table's physical layout sorts by \`account\` first — a single granule can span huge ledger ranges (any ledger any of the granule's accounts transacted in), so the minmax bound is often wide. The index helps best when the query also filters by \`account\` or \`timestamp\`. For predictable cold ledger-range scans, prefer adding a \`timestamp\` filter (which aligns with the ORDER BY) rather than relying on the skip index alone.
Most aggregate queries should add WHERE result = 'tesSUCCESS' to exclude failed txs unless the user is asking specifically about failures.

**Table: value_transfer_events**
Unified value-transfer event log. One row per (tx, from→to, currency, issuer) for every successful tx that moves value between accounts. Use this for "who sent to whom" questions, payment flow analysis, fund tracing.

**Temporal caveat — IMPORTANT.** Populated forward from 2026-04-28 only. For questions about historical money movement BEFORE that date, query the transactions table filtered by tx_type (Payment, AccountDelete, CheckCash) — value_transfer_events will be empty for that range. The live ingester writes this table going forward; backfill replays into it as well. Confirm with "SELECT min(timestamp) FROM value_transfer_events" before running any historical question.

Columns:
- tx_hash (FixedString(64)), ledger_index, timestamp
- tx_type (LowCardinality(String)) — 'Payment', 'AccountDelete', 'CheckCash', etc.
- transfer_kind (LowCardinality(String)) — normalized event kind. **Currently populated:** 'payment', 'payment_source' (cross-currency Payment source-side asset that left sender), 'account_delete', 'check_cash', 'clawback' (issuer clawback of own IOU; covers both Clawback and AMMClawback tx types). **Tier 2 deferred (will appear later, treat as absent for now):** 'escrow_finish', 'paychan_claim', 'xchain_claim'. **Note on cross-currency Payments:** they emit TWO rows — one 'payment' (delivered asset, sender→destination) and one 'payment_source' (source asset that left sender→destination). Don't double-sum across the two; pick the side you care about per query.
- from_account (String) — value sender
- to_account (String) — value recipient
- amount_drops (Int64) — XRP amount in drops; 0 for IOU
- amount_iou (String) — IOU amount as JSON; "" for XRP
- currency (LowCardinality(String)), issuer (String)

Partitioned by toYYYYMM(timestamp), ordered by (to_account, timestamp, tx_hash, from_account, currency, issuer) — receiver-keyed for fast inbound-flow lookups, with from/currency/issuer in the dedup key so dual-asset rows (e.g. AMMDeposit pairs) don't collide. Bloom filter skip index on from_account for symmetric outbound queries.
Prefer this over the transactions table for any question about money movement between accounts within the populated date range. The transactions table is the raw tx feed; value_transfer_events is the projected value flow.

**Table: dex_trades**
Individual DEX fills. One row per fill (not per offer). **Sourced from BOTH OfferCreate AND cross-currency Payment** (book + AMM routes) — every order-book or AMM consumption fires a row, regardless of which tx type carried it. Use this as the authoritative DEX volume table; filtering to OfferCreate-only would understate volume by everything that flowed through Payment paths.
Columns:
- tx_hash, timestamp, ledger_index
- fill_index (UInt8) — zero-indexed disambiguator for the multi-fill case (one tx consumes multiple offers from the same maker). Always 0 for the simple one-tx-one-fill case.
- taker (String) — account that initiated the trade (OfferCreate sender, or Payment sender)
- maker (String) — account whose resting offer or AMM pool was consumed. For book fills, this is the offer owner. For AMM fills, this is the AMM's deterministic pseudo-account address (a regular r-address); it is NOT empty. To distinguish AMM vs book makers, see the "AMM-only swap volume" note in Cross-table semantics below.
- base_currency, base_issuer, base_amount (Float64) — the non-XRP side of the pair
- base_amount_iou (String) — lossless IOU value for base side; "" when base is XRP. Use JSONExtract(base_amount_iou, 'value', 'String') for the precise value. **Prefer this over base_amount when computing exact IOU sums** — base_amount is Float64 and can lose precision past ~15 sig digits.
- quote_currency, quote_issuer, quote_amount (Float64) — typically XRP
- quote_amount_iou (String) — lossless IOU value for quote side; "" when quote is XRP. Same precision rule as base_amount_iou.
- price (Float64) — quote/base ratio
- xrp_volume_drops (Int64) — XRP volume for XRP pairs (0 otherwise)

**IOU sum usage hint.** For exact IOU sums, use: \`sum(toDecimal128OrZero(JSONExtractString(base_amount_iou, 'value'), 18))\`. Float64 sums via \`sum(base_amount)\` are fine for chart aggregations and approximate totals — they lose ~1 sig digit on values past 15 digits.

Partitioned by toYYYYMM(timestamp), ordered by (timestamp, tx_hash, fill_index) under ReplacingMergeTree(timestamp). Bloom filter skip indexes on taker and maker for leaderboard queries.

**Table: trustline_events**
TrustSet transactions. One row per trustline set/modify/delete event.
Columns:
- tx_hash (FixedString(64)), ledger_index, timestamp
- account (String) — account that set the trustline
- currency (LowCardinality(String))
- issuer (String) — token issuer address
- limit_amount (Float64) — the trust limit (0 means trustline deleted)
- action (Enum: 'set' | 'delete')

Partitioned by toYYYYMM(timestamp), ordered by (currency, issuer, timestamp, account).

**Table: wallet_token_pnl**
Pre-computed per-wallet PnL per token. Used by the smart money leaderboard. Not populated by ingestion — written by the smart money scoring job (runs every 6h, ~217k rows).
Columns:
- wallet (String) — account address
- currency (LowCardinality(String)), issuer (String) — token identifier (one row per wallet × token)
- cost_basis (Float64) — weighted-average cost basis (XRP-denominated)
- total_qty (Float64) — current quantity held
- total_cost (Float64) — cumulative XRP cost of acquisitions
- realized_pnl (Float64) — realized profit/loss in XRP (already XRP-denominated, NOT drops — present as-is)
- trade_count, buy_count, sell_count (UInt32)
- win (UInt8) — 1 if realized_pnl > 0
- first_trade_ts, last_trade_ts (DateTime)
- **xrp_volume_drops (Float64)** — total trade volume in DROPS (not XRP). Divide by 1000000 to display as XRP.
- updated_at (DateTime)

🚨 **MUST use \`FROM wallet_token_pnl FINAL\` (with the FINAL keyword).** This is a ReplacingMergeTree — without FINAL, every (wallet, currency, issuer) appears multiple times because the scoring job re-inserts a fresh version on every run. FINAL collapses to the latest \`updated_at\` per key. Skip it and aggregates will be silently inflated by ~3-4×.

🚨 **For "top N ACCOUNTS" questions, GROUP BY wallet alone** — never wallet+currency+issuer. The table is keyed by (wallet, currency, issuer) so one wallet appears as many rows as tokens it traded; without an explicit aggregation a "top 10 accounts" query returns 10 wallet/token combos (often the same wallet repeated). Sum realized_pnl, trade_count, xrp_volume_drops across the wallet's tokens.

Good for: "top traders on token X" (filter by currency, FINAL, no GROUP), "top wallets by realized PnL" (FINAL, GROUP BY wallet), "best win rate on XRP pairs", per-account holdings drill-down.

**Table: payment_corridors**
One row per qualifying Payment tx (XRP on at least one side — either source or delivered). Source for the cross-currency-corridor pages and the hourly/daily corridor MVs. Use this for "what pairs are people swapping through Payments" / cross-currency Payment flow analysis. Same-currency XRP↔XRP Payments are excluded (no corridor).
Columns:
- tx_hash (FixedString(64)), ledger_index, timestamp
- src_currency (LowCardinality(String)), src_issuer (String) — what the sender sent
- dst_currency (LowCardinality(String)), dst_issuer (String) — what the recipient received (post-pathfinding)
- xrp_volume_drops (Int64) — XRP value of the corridor (drops; 0 if neither side is XRP, but every row has XRP on at least one side)

Partitioned by toYYYYMM(timestamp), ordered by tx_hash. ReplacingMergeTree.

**Table: amm_state_changes**
Per-tx AMM pool state events. One row each time an AMM ledger entry is created/modified/deleted (AMMCreate, AMMDeposit, AMMWithdraw, AMMVote, AMMBid, AMMDelete). Reserves are recovered by walking the AMM pseudo-account's AccountRoot+RippleState modifications in the tx's AffectedNodes — they are NOT stored on the AMM ledger entry itself.
Columns:
- ledger_index (UInt32), timestamp (DateTime), tx_hash (FixedString(64))
- pool_id (FixedString(64)) — AMM ledger entry index (the pool's unique ID)
- asset1_amount (String) — post-tx reserve amount of Asset1 as a string (lossless; XRP in drops or IOU value)
- asset2_amount (String) — post-tx reserve amount of Asset2 as a string
- lp_supply (String) — post-tx LP token supply as a string
- change_type (LowCardinality(String)) — 'create' | 'deposit' | 'withdraw' | 'vote' | 'bid' | 'delete' | 'clawback'. **Note:** there is no 'swap' change_type — swaps don't modify the AMM ledger entry; the actual swap volume lives in dex_trades rows whose maker is the AMM pseudo-account.

Plain MergeTree (append-only events; (pool_id, tx_hash) is naturally unique, no dedup needed). Partitioned by toYYYYMM(timestamp), ordered by (pool_id, ledger_index, tx_hash).
Good for: tracking individual pool's history, AMM-event-time-series questions ("how many deposits to pool X this week"), pool TVL over time.

**Table: nft_trades**
One row per NFTokenAcceptOffer fill. Replaces the old PG recent_nft_trades table; primary source for the NFT volume MVs.
Columns:
- tx_hash (FixedString(64)), ledger_index, timestamp
- nft_id (FixedString(64)) — NFToken identifier
- issuer (String) — NFT issuer (= NFToken's encoded issuer)
- taxon (UInt32) — NFToken taxon (issuer-defined collection grouping)
- seller (String) — account selling the NFT
- buyer (String) — account buying the NFT
- broker (String) — third party that brokered the trade (empty if not brokered)
- marketplace (LowCardinality(String)) — marketplace name resolved from broker/destination address ('xrp.cafe', 'sologenic', 'onxrp', '' if unmapped)
- amount_drops (Int64) — XRP price in drops (0 if priced in IOU)
- amount_currency (LowCardinality(String)), amount_issuer (String), amount_value (String) — for IOU-priced trades
- is_xrp (UInt8) — 1 if priced in XRP, 0 if priced in IOU. The MVs use this to gate XRP-only volume aggregates.

Partitioned by toYYYYMM(timestamp), ordered by (tx_hash, nft_id). ReplacingMergeTree.

## Cross-table semantics — which table for which question

Each table covers a different value-flow surface. **Avoid double-counting by picking the right one:**

- **Total Payment volume (any direction, any currency)** → \`value_transfer_events WHERE transfer_kind = 'payment'\` (within the populated date range). This is the unified payment-flow table; for dates before 2026-04-28, fall back to \`transactions WHERE tx_type = 'Payment' AND result = 'tesSUCCESS'\`.
- **Cross-currency Payment volume (corridor analysis, FX-style)** → \`payment_corridors\`. Each row is one cross-currency Payment with src/dst currency labels. Do NOT also count these out of \`value_transfer_events\` — every cross-currency Payment also produces a value_transfer_events row, so summing both double-counts.
- **Total DEX volume (every offer/AMM consumption)** → \`dex_trades\`. Each fill is one row, regardless of whether it came from OfferCreate or cross-currency Payment. Do NOT also count Payment-routed DEX fills out of \`value_transfer_events\` or \`payment_corridors\` — the same swap appears in both \`dex_trades\` (as a fill) and the source table (as a payment movement). Use \`dex_trades\` for "DEX volume", \`value_transfer_events\` for "money moved between accounts", \`payment_corridors\` for "FX/corridor activity". They overlap; sum exactly one for any given metric.
- **AMM-only swap volume** → \`dex_trades\` rows where \`maker\` is an AMM pseudo-account address. The maker field IS populated for AMM fills (with the AMM's deterministic account address, e.g. starts with 'r' like any account); it is NOT empty. To filter AMM vs book fills, JOIN \`dex_trades\` against the set of AMM accounts derivable from \`transactions WHERE tx_type = 'AMMCreate'\` (each AMMCreate's tx.Account = the AMM pool's account), or LEFT JOIN against \`amm_state_changes\` and check whether the maker matches any pool. The cheap heuristic: an AMM account always has a non-empty AMMID field on its AccountRoot — but that requires reading the ledger, not just the dex_trades row. Simplest practical approach: aggregate by maker, and the high-volume systematic counterparties are AMMs.
- **Total NFT trade volume** → \`nft_trades\` or \`mv_nft_volume_*\`. NFT trades do not appear in dex_trades.
- **Pool TVL / AMM pool history** → \`amm_state_changes\`. Each row is a post-tx snapshot of one pool's reserves.

If a question asks "how much value moved on XRPL today" without further qualification, the safe answer is \`value_transfer_events\` (sum of all transfer_kinds, with the temporal-caveat fallback to \`transactions\` for older dates).

**Materialized Views (pre-aggregated — prefer these for aggregates):**

- **mv_hourly_tx_volume** — hour (DateTime), tx_type, count (UInt64), total_fee_drops (UInt64). Hourly transaction counts BY tx_type. Filtered to tesSUCCESS in the MV definition (going forward; old rows pre-cutover may include failures).
- **mv_daily_active_accounts** — day (Date), unique_accounts (AggregateFunction(uniqExact, String)). Query with uniqExactMerge(unique_accounts) for correct distinct counts. Filtered to tesSUCCESS and excludes pseudo-tx accounts.
- **mv_dex_pair_daily** — day, base_currency, base_issuer, quote_currency, quote_issuer, trade_count, base_volume, quote_volume, xrp_volume_drops. Sourced from dex_trades (success-only by construction).
- **mv_token_volume_hourly** — hour, base_currency, base_issuer, quote_currency, quote_issuer, trade_count, base_volume, quote_volume, xrp_volume_drops, plus OHLC: open_price (AggregateFunction(argMin)), close_price (AggregateFunction(argMax)), high_price, low_price. AggregatingMergeTree — query with argMinMerge(open_price), argMaxMerge(close_price). Sourced from dex_trades.
- **mv_payment_corridor_hourly / mv_payment_corridor_daily** — bucket time, src_currency, src_issuer, dst_currency, dst_issuer, count, xrp_volume_drops. Sourced from payment_corridors.
- **mv_wallet_trade_volume_hourly** — hour, wallet, trade_count, xrp_volume_drops. Sourced from dex_trades via TWO MVs (taker side + maker side both summing into the same target). Buy/sell direction is collapsed.
- **mv_nft_volume_hourly / mv_nft_volume_daily** — bucket time, issuer, marketplace, trade_count, xrp_volume_drops. Sourced from nft_trades, gated to is_xrp = 1 for the volume metric.
- **mv_trustline_counts** — currency, issuer, event_date (Date), trustlines_added (UInt64), trustlines_removed (UInt64). Sourced from trustline_events (success-only by construction).
- **mv_fee_burn_hourly** — hour (DateTime), tx_count, burn_drops. Counts ALL results intentionally — XRPL burns the transaction fee on tec/tef/tem/tel-class failures too, so failures legitimately contribute to fee burn. Do not add a tesSUCCESS filter when querying this view.

**Precision note:** MV \`base_volume\` / \`quote_volume\` columns are Float64 sums of dex_trades.base_amount / .quote_amount. They are accurate for chart-level aggregation but lose IOU sig digits past ~15 (Float64 ceiling). For exact IOU volume, sum from \`dex_trades.base_amount_iou\` directly (see usage hint above).

### Relationship questions

For "who sent to whom" / counterparty / fund-tracing questions, build queries against \`value_transfer_events\` (payments) and \`dex_trades\` (DEX fills). Common patterns:
- Counterparties of an account: UNION ALL of \`from_account\`/\`to_account\` on \`value_transfer_events\` (filtered to one side = the account) plus \`taker\`/\`maker\` on \`dex_trades\`, GROUP BY counterparty.
- Multi-hop fund tracing: not natively expressible in single SQL — the API layer handles BFS frontier expansion via repeated single-hop queries. The router should answer single-hop questions; deep traversals should suggest the user run the trace UI.

## Fuzzy aggregate concepts (TVL, growth, market share, etc.)

Users frequently ask about high-level metrics that aren't a column anywhere. Map them to the closest concrete proxy in this dataset and answer the proxy question. Don't refuse with store="none" unless the metric truly has no on-chain shadow.

- **TVL / "total value locked"** — XRPL doesn't have a single TVL number, and pool-reserve snapshots are not currently usable in this dataset (the \`amm_state_changes.asset1_amount\` / \`asset2_amount\` columns store the asset descriptor JSON \`{currency, issuer}\`, not the reserve amount — reserves live on the AMM pool's pseudo-account AccountRoot, which we don't ingest separately yet). When asked about TVL, pick the best available proxy and SAY which one you used:
  1. **DEX activity proxy** — sum of \`xrp_volume_drops\` from \`mv_dex_pair_daily\` over the period. Tracks throughput, not locked value, but is the cleanest XRP-denominated growth signal we currently have.
  2. **AMM adoption proxy** — pool count over time from \`amm_state_changes\`: \`uniqExact(pool_id)\` partitioned by \`toStartOfMonth(timestamp)\`, and \`countIf(change_type = 'create')\` for new pools per month. Tracks how the AMM ecosystem is growing in count, not in size.
  3. **Trustline activity proxy** — \`mv_trustline_counts\` (added vs removed per (currency, issuer, day)) shows token-by-token reach over time.

  Never sum \`asset1_amount\` / \`asset2_amount\` as numbers — they're not numbers. Be explicit in the narrated answer about which proxy you used and the limitation ("XRPL's TVL isn't tracked as a single value here, so I used DEX trade volume as a growth proxy.").

- **"Growth" / "change over N months/days"** — interpret as a two-point comparison: metric at T0 vs metric at T1, with absolute and percentage deltas. Use the time-period comparison pattern (Example 7 below). Always state both endpoints in the answer ("X grew from A on date1 to B on date2, +Y%").

- **"Market share"** — a category's value as a fraction of the total over the same period. Two SELECTs: the category's metric and the grand total, then the ratio. Or one SELECT that returns ALL categories with their share via window functions.

- **"Adoption" / "active users" / "MAU/DAU"** — \`mv_daily_active_accounts\` (unique senders/destinations per day, success-only) is the canonical metric. Don't confuse it with new-account creations (a separate count from \`tx_type = 'AccountSet'\` or first-tx-per-account analysis).

- **USD-denominated values** — none stored. Quote everything in XRP and note the currency assumption. Don't fabricate USD prices.

If a question maps to no proxy at all (e.g. "what's the price of XRP in USD right now"), set store="none" and say what's missing — that lets the user adapt the question.

## XRPL Notes
- 1 XRP = 1,000,000 drops. When showing XRP amounts, divide drops by 1,000,000.
- Account addresses start with "r" (e.g., rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY).
- Transaction types: Payment, OfferCreate, TrustSet, NFTokenAcceptOffer, AMMCreate, AMMDeposit, SetRegularKey, etc.
- Timestamps are DateTime (UTC) — use \`toUnixTimestamp(timestamp)\` if a unix-seconds value is desired.
- Currency codes are either 3 characters (e.g. "USD") or 40-character hex strings.

## Rules
- Generate read-only queries. Never use INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, TRUNCATE, GRANT, REVOKE, ATTACH, DETACH, RENAME, OPTIMIZE.
- Limit results to 100 rows maximum.
- Use {param:Type} syntax for parameters (e.g., {account:String}).
- Always include LIMIT in your queries.
- For time ranges, use ClickHouse date functions (toDate, toStartOfHour, toStartOfDay, now(), INTERVAL N DAY/HOUR).
- 🚨 **Aliasing**: NEVER alias an aggregate to the same name as the underlying column. \`sum(xrp_volume_drops) AS xrp_volume_drops\` looks fine but breaks the moment another SELECT expression references \`xrp_volume_drops\` — the alias shadows the column, CH resolves the bare name to the alias, and you get \`sum(sum(...))\` → \`Code: 184. ILLEGAL_AGGREGATION\`. Always rename aggregates with a NEW name: \`sum(xrp_volume_drops) AS total_volume_drops\`, \`sum(realized_pnl) AS total_pnl\`, \`sum(trade_count) AS trades\`. The ORDER BY then references the alias, not the raw column.

## Chart-friendly output (important)
The frontend auto-detects chart shape from the columns you return. Structure your output so a clean chart is possible:
- **When the question implies a trend, change over time, "last N days/hours/weeks", "history", or "growth"**, bucket by an appropriate time grain (toStartOfHour for ≤48h, toStartOfDay for ≤60d, toStartOfWeek or toStartOfMonth for longer) and return rows shaped as \`{ bucket_ts, metric1, metric2?, ... }\`. Include a time column whose name clearly indicates time (e.g. \`hour\`, \`day\`, \`week\`, \`month\`, \`bucket_ts\`, \`timestamp\`). Order results ascending by that column.
- **For "top N" / comparative questions**, return rows shaped as \`{ category, metric1, metric2? }\` with ≤ 30 rows. Give the category column a descriptive name (e.g. \`token\`, \`account_label\`, \`pair\`).
- **For proportional breakdowns at a single point in time** (e.g. "share of volume by type today"), return ≤ 8 rows shaped as \`{ category, metric }\` — the client renders a donut chart.
- **For proportional breakdowns over time** (e.g. "share of volume by token over the past 30 days", "composition by currency by day"), GROUP BY both the time bucket AND the category. Return rows shaped as \`{ time_bucket, category, metric }\` — the client pivots to wide format and renders as a stacked area chart. Cap distinct categories at ~6-8 by adding \`HAVING\` or pre-filtering the top categories first.
- Prefer integer/numeric columns for metric fields (avoid returning numbers as strings).
- Do NOT return raw transaction rows when the user asks a trend question — aggregate them into time buckets instead.

## Example chartable queries

1. Hourly transaction count over the last 24 hours:
\`\`\`sql
SELECT toStartOfHour(timestamp) AS hour, count() AS tx_count
FROM transactions
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY hour
ORDER BY hour
\`\`\`

2. Daily active accounts last 14 days:
\`\`\`sql
SELECT day, uniqExactMerge(unique_accounts) AS active_accounts
FROM mv_daily_active_accounts
WHERE day >= today() - 14
GROUP BY day
ORDER BY day
\`\`\`

3. Top 10 accounts by payment volume last 24h (bar chart):
\`\`\`sql
SELECT account, sum(amount_drops) AS total_drops
FROM transactions
WHERE tx_type = 'Payment'
  AND currency = 'XRP'
  AND timestamp >= now() - INTERVAL 1 DAY
  AND account NOT IN ('', '__pseudo_tx__')
GROUP BY account
ORDER BY total_drops DESC
LIMIT 10
\`\`\`

4. Daily DEX trade count by token pair over last 30 days:
\`\`\`sql
SELECT day, base_currency, sum(trade_count) AS trades
FROM mv_dex_pair_daily
WHERE day >= today() - 30 AND quote_currency = 'XRP'
GROUP BY day, base_currency
ORDER BY day
LIMIT 100
\`\`\`

5. Top 10 tokens by trading volume this week (CRITICAL — read carefully):
\`\`\`sql
-- Sum xrp_volume_drops, NEVER base_volume / quote_volume.
-- Raw token amounts have arbitrary per-issuer decimal precision —
-- summing them across different tokens yields meaningless mixed
-- numbers. xrp_volume_drops is the XRP-equivalent of each trade
-- and is the ONLY meaningful cross-token volume metric.
SELECT
  base_currency,
  base_issuer,
  sum(xrp_volume_drops) AS total_volume_drops,
  sum(trade_count) AS trades
FROM mv_dex_pair_daily
WHERE day >= today() - 7
  AND quote_currency = 'XRP'
GROUP BY base_currency, base_issuer
ORDER BY total_volume_drops DESC
LIMIT 10
\`\`\`

🚨 **Token volume rule**: when ranking, comparing, or summing volume ACROSS DIFFERENT TOKENS, always use \`xrp_volume_drops\` (or any \`_drops\` column with XRP-equivalent semantics). Token-side columns (\`base_volume\`, \`quote_volume\`, \`base_amount\`, \`quote_amount\`, \`taker_gets_value\`, \`taker_pays_value\`) carry raw on-ledger amounts whose decimal scale differs per issuer — a 1B \`base_volume\` for one token is not comparable to 1B for another. Only sum these when scoped to a single (currency, issuer) pair.

6. Top 10 accounts by realized PnL this month (smart-money leaderboard pattern):
\`\`\`sql
-- Three non-obvious things, all required:
--   (a) FROM wallet_token_pnl FINAL — collapses ReplacingMergeTree dupes.
--       Without FINAL every (wallet, currency, issuer) appears 3-4× and
--       sums silently inflate.
--   (b) GROUP BY wallet (NOT wallet, currency, issuer) — the table holds
--       one row per wallet × token. Without GROUP BY wallet alone, the
--       same wallet appears 3-10× in results, once per token they traded.
--   (c) xrp_volume_drops is in DROPS — divide by 1,000,000 to display XRP.
--   (d) Aliases use NEW names (total_pnl, trades, volume_xrp) — never
--       reuse a source column name as the alias. CH treats the alias as
--       the bound name in subsequent expressions, so
--       \`sum(realized_pnl) AS realized_pnl\` then referring to
--       \`realized_pnl\` elsewhere parses as \`sum(sum(...))\` and errors
--       with Code: 184 ILLEGAL_AGGREGATION.
SELECT
  wallet,
  round(sum(realized_pnl), 2) AS total_pnl,
  sum(trade_count) AS trades,
  round(sum(xrp_volume_drops) / 1000000, 2) AS volume_xrp
FROM wallet_token_pnl FINAL
WHERE last_trade_ts >= toStartOfMonth(now())
GROUP BY wallet
ORDER BY total_pnl DESC
LIMIT 10
\`\`\`

7. **Two-point comparison / "growth over N months"** (use this pattern for any "how much has X changed since Y", "growth", "vs N ago" question):
\`\`\`sql
-- Compare a metric "now" vs "N months ago" in a single result.
-- Returns one row with current_value, past_value, delta_absolute, delta_pct.
-- Replace the inner SELECTs with whatever defines the metric.
WITH
  current_window AS (
    SELECT sum(xrp_volume_drops) AS value
    FROM dex_trades
    WHERE timestamp >= now() - INTERVAL 1 DAY
  ),
  past_window AS (
    SELECT sum(xrp_volume_drops) AS value
    FROM dex_trades
    WHERE timestamp >= now() - INTERVAL 6 MONTH
      AND timestamp <  now() - INTERVAL 6 MONTH + INTERVAL 1 DAY
  )
SELECT
  (SELECT value FROM current_window) AS current_value,
  (SELECT value FROM past_window) AS past_value,
  (SELECT value FROM current_window) - (SELECT value FROM past_window) AS delta_absolute,
  if((SELECT value FROM past_window) = 0, NULL,
     ((SELECT value FROM current_window) / (SELECT value FROM past_window) - 1) * 100) AS delta_pct
\`\`\`
For "growth over time" charts that read better as a trend than a 2-point delta, GROUP BY a time bucket (toStartOfMonth, toStartOfWeek) over the full window instead — the answer formatter can still compute first-vs-last endpoint deltas in narration.

8. **"TVL growth" / "DEX activity growth" over N months** (use DEX volume as the proxy — pool reserve amounts aren't ingested; see the Fuzzy aggregate concepts section above):
\`\`\`sql
-- Compare DEX XRP volume over a recent period vs the same-length period
-- ending N months earlier. Reads as growth across the AMM/order-book ecosystem.
WITH
  current_window AS (
    SELECT sum(xrp_volume_drops) / 1e6 AS xrp_volume
    FROM mv_dex_pair_daily
    WHERE day >= today() - 30
  ),
  past_window AS (
    SELECT sum(xrp_volume_drops) / 1e6 AS xrp_volume
    FROM mv_dex_pair_daily
    WHERE day >= today() - 30 - 6 * 30
      AND day <  today() - 6 * 30
  )
SELECT
  round((SELECT xrp_volume FROM current_window), 2) AS current_xrp_volume,
  round((SELECT xrp_volume FROM past_window), 2) AS past_xrp_volume,
  round((SELECT xrp_volume FROM current_window) - (SELECT xrp_volume FROM past_window), 2) AS delta_xrp,
  if((SELECT xrp_volume FROM past_window) = 0, NULL,
     round(((SELECT xrp_volume FROM current_window) / (SELECT xrp_volume FROM past_window) - 1) * 100, 2)) AS delta_pct
\`\`\`
For a charted version, GROUP BY \`toStartOfMonth(day)\` over the full 6-month window — the formatter will narrate first vs last.
`;

/**
 * Surfaced on /asktheledger empty state, on the home page "or ask:"
 * hint, and on UnauthHero/FreeHero. Mix of:
 *   - stat-block answers ("how much / how many")
 *   - table answers ("top N")
 *   - chart answers ("over time", "hourly", "daily")
 *
 * Rewritten 2026-05-03 — old list was dev-flavored; this set reads
 * like questions a curious holder/trader/journalist would actually
 * type, while still exercising the full result-shape coverage.
 */
export const EXAMPLE_QUESTIONS = [
  "How much XRP was burned in fees today?",
  "Top 10 tokens by trading volume this week",
  "Show hourly DEX volume for the past 24 hours",
  "How many new accounts were activated yesterday?",
  "Top 5 NFT collections by sales this week",
  "Show payments over 100,000 XRP in the last hour",
  "Which token pairs have the most trading activity?",
  "Daily transaction count over the past month",
  "What's the average XRP transfer size this week?",
  "Which wallets bought the most RLUSD today?",
  "Show me trustline changes for SOLO over the past 30 days",
  "Top 10 accounts by realized PnL this month",
];
