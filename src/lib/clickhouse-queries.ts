/**
 * Read-side ClickHouse query helpers for the explorer pages (account / tx /
 * ledger). Lets the highest-traffic surfaces server-render from indexed
 * historical data instead of round-tripping every load to public rippled
 * clusters.
 *
 * What CH serves cheaply (this file):
 *   - Tx by hash — `idx_tx_hash` bloom filter prunes granules
 *   - Tx history per account (sender side hits the `transactions` PK)
 *   - Txs in a ledger — `idx_ledger_index` minmax index
 *   - Ancestry / earliest inbound Payment — `value_transfer_events`
 *     ordered by `(to_account, timestamp, ...)`
 *
 * What CH legitimately can't serve and stays on rippled:
 *   - Live ledger STATE — account_objects, account_offers, account_nfts,
 *     account_lines. We don't mirror state in CH today.
 *
 * Receiver-side tx history and AffectedNodes-only relationships are NOT
 * here yet — those route through `value_transfer_events` (existing) and
 * the new `account_tx_index` table (slice 5) respectively. See
 * `docs/plans/db-first-page-loads.md` for the synthesis-first plan.
 *
 * The transactions table stores the original tx body and meta as
 * `tx_json` / `meta_json` blobs, so we can reconstruct a rippled-shaped
 * `TxResponse` at read time. Consumers that only need fast columnar
 * fields (tx_type, fee, timestamp, etc.) can read them directly.
 */

import "server-only";
import { query } from "./clickhouse-client";
import type { TxResponse } from "@/types/xrpl-responses";
import type {
  AncestryData,
  InitialAccountHistory,
} from "@/hooks/useAccountData";
import type { ResolvedRange } from "./account-tx-range";

/* ── Types ──────────────────────────────────────────────────────────── */

// `query<T>()` constrains T to `Record<string, unknown>`. Each row shape
// below carries a string index signature so it satisfies that constraint
// while still narrowing the columns we actually return.

interface TxByHashRow extends Record<string, unknown> {
  tx_hash: string;
  tx_type: string;
  account: string;
  destination: string;
  fee_drops: number;
  ledger_index: number;
  /** Seconds since the XRPL epoch (2000-01-01 UTC). Already shifted in SQL. */
  xrpl_date: number;
  result: string;
  tx_json: string;
  meta_json: string;
}

interface TxRowForLedger extends Record<string, unknown> {
  tx_hash: string;
  tx_type: string;
  account: string;
  destination: string;
  amount_drops: string;
  amount_iou: string;
  currency: string;
  issuer: string;
  fee_drops: number;
  ledger_index: number;
  xrpl_date: number;
  result: string;
}

/** XRPL epoch — 2000-01-01 UTC, used to convert CH unix timestamps
 *  to the `date` field that rippled-shaped TxResponses expect. */
const XRPL_EPOCH_OFFSET_S = 946_684_800;

/* ── Tx by hash ─────────────────────────────────────────────────────── */

/**
 * Look up a single transaction by hash. Returns a `TxResponse`-shaped
 * object reconstructed from the stored `tx_json` and `meta_json` blobs.
 * Returns `null` when the hash isn't present in CH (older than backfill,
 * or just not yet replicated). Caller should fall back to rippled.
 *
 * The tx and meta blobs are stored verbatim from the ingester
 * (`JSON.stringify(rawTx)` / `JSON.stringify(meta)`), so the parsed
 * shape is interchangeable with `xrplClient.getTransaction`'s response.
 */
export async function getTxByHash(hash: string): Promise<TxResponse | null> {
  if (!/^[A-Fa-f0-9]{64}$/.test(hash)) return null;
  const rows = await query<TxByHashRow>(
    `SELECT
        tx_hash,
        tx_type,
        account,
        destination,
        fee_drops,
        ledger_index,
        toUInt32(toUnixTimestamp(timestamp) - ${XRPL_EPOCH_OFFSET_S}) AS xrpl_date,
        result,
        tx_json,
        meta_json
     FROM transactions
     WHERE tx_hash = {hash:String}
     LIMIT 1`,
    { hash: hash.toUpperCase() },
  );
  if (rows.length === 0) return null;
  return rowToTxResponse(rows[0]);
}

/**
 * Reconstruct a `TxResponse` from a CH row. Falls back to the typed
 * columns when `tx_json` / `meta_json` are empty (older "tier-blob"
 * rows where we kept only the columnar fields).
 */
function rowToTxResponse(row: TxByHashRow): TxResponse {
  // Parse stored blobs first — these contain the full original tx + meta
  // and are the closest to what rippled would return.
  let parsedTx: Record<string, unknown> = {};
  let parsedMeta: Record<string, unknown> | null = null;
  try {
    if (row.tx_json) parsedTx = JSON.parse(row.tx_json) as Record<string, unknown>;
  } catch {
    /* fall through to columnar fields below */
  }
  try {
    if (row.meta_json) parsedMeta = JSON.parse(row.meta_json) as Record<string, unknown>;
  } catch {
    /* leave meta null; consumers gracefully degrade */
  }

  // Merge: parsed blob (full fidelity) wins, but always overlay the
  // canonical lookup keys. A tier-blob row with no tx_json still
  // produces a usable response from the columnar fields alone.
  //
  // The double cast (`as unknown as TxResponse`) is intentional —
  // TxResponse's `meta` typing requires the strict TxMeta shape, and
  // the existing `xrplClient.getTransaction` consumers already treat
  // meta as loosely typed (see `tx as any` in the tx page). Bringing
  // both paths to the same loosely-typed assertion keeps consumer
  // code unchanged while the parsed JSON carries the exact rippled shape.
  const merged = {
    ...parsedTx,
    hash: row.tx_hash,
    TransactionType: row.tx_type,
    Account: row.account,
    Destination: row.destination || undefined,
    Fee: String(row.fee_drops),
    ledger_index: row.ledger_index,
    date: row.xrpl_date,
    meta: parsedMeta ?? undefined,
  };
  return merged as unknown as TxResponse;
}

/* ── Txs for an account ─────────────────────────────────────────────── */

interface AccountTxRow extends Record<string, unknown> {
  tx_hash: string;
  /** CH DateTime literal (`YYYY-MM-DD HH:MM:SS`). Forms the cursor. */
  timestamp: string;
  /** XRPL date (seconds since 2000-01-01 UTC). Overlaid onto the parsed
   *  `tx` blob since `tx_json` doesn't always carry `date` itself. */
  xrpl_date: number;
  ledger_index: number;
  tx_json: string;
  meta_json: string;
}

/** Single account_tx-shaped item — `{ tx, meta, validated, timestamp }`,
 *  matching rippled's `account_tx` shape with one addition: `timestamp`
 *  carries the CH row's DateTime literal (`YYYY-MM-DD HH:MM:SS`) so
 *  cursor reconstruction in the merged helper doesn't have to dig
 *  through the `tx` blob. (The blob's `date` field is unreliable —
 *  `tx_json` doesn't always serialize it consistently, which broke
 *  pagination beyond page 1 before this field was added.)
 *  CH only stores validated ledgers, so `validated` is always `true`. */
export interface AccountTxItem {
  tx: Record<string, unknown>;
  meta: Record<string, unknown>;
  validated: true;
  /** CH row timestamp string (`YYYY-MM-DD HH:MM:SS`), forms the cursor
   *  for paginated walks alongside `tx.hash`. */
  timestamp: string;
}

export interface AccountTxCursor {
  timestamp: string;
  txHash: string;
}

export interface AccountTxsResult {
  items: AccountTxItem[];
  /** Cursor for the next older page. `null` when there's no more history. */
  nextCursor: AccountTxCursor | null;
  /** Latest ledger_index seen for this account in CH. Powers the
   *  "as of ledger N → live" status indicator on the account page. */
  asOfLedger: number | null;
}

/**
 * Most recent transactions touching an account (sender side only at this
 * tier), descending by timestamp.
 *
 * Hits the `transactions` PK directly via `WHERE account = X`. Sub-
 * millisecond for any account.
 *
 * Receiver-side coverage (Payments delivered to this account, AccountDelete
 * beneficiaries, AMMDeposit/Withdraw counterparts, Clawback recipients) is
 * NOT served from this query — those route through `value_transfer_events`
 * which is already ordered by `to_account` and covers more transfer kinds
 * than a `WHERE destination = X` scan would. AffectedNodes-only
 * relationships (offer crosses, AMM LP shares moved by someone else's
 * tx) route through the `account_tx_index` table once slice 5 lands.
 *
 * The outer account page query merges these three sources; this helper
 * is the sender-side primitive.
 */
export async function getTxsForAccount(
  address: string,
  opts: {
    limit?: number;
    before?: AccountTxCursor;
    /** Inclusive lower bound — CH `DateTime` literal `YYYY-MM-DD HH:MM:SS`. */
    fromTs?: string;
    /** Inclusive upper bound — CH `DateTime` literal `YYYY-MM-DD HH:MM:SS`. */
    toTs?: string;
  } = {},
): Promise<AccountTxsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  // Cursor: strict-tuple comparison `(timestamp, tx_hash) < (cursor)` so
  // same-timestamp ties (rare but possible) are stably ordered. Qualified
  // `transactions.timestamp` is required everywhere we reference the
  // DateTime column in WHERE — the SELECT below aliases `toString(timestamp)
  // AS timestamp`, and CH's planner otherwise resolves bare `timestamp` in
  // WHERE to the String alias, causing a NO_COMMON_TYPE error against the
  // DateTime parameter binding.
  const cursorClause = opts.before
    ? `AND (transactions.timestamp, tx_hash) < ({beforeTs:DateTime}, {beforeHash:String})`
    : "";
  // Date-range bounds — the PK leads with `account` then `timestamp DESC`,
  // so `timestamp >= from` lets CH skip granules cleanly. Both bounds are
  // optional; when both are missing the filter is unbounded (whole history
  // for this account).
  const fromClause = opts.fromTs ? `AND transactions.timestamp >= {fromTs:DateTime}` : "";
  const toClause = opts.toTs ? `AND transactions.timestamp <= {toTs:DateTime}` : "";
  const params: Record<string, unknown> = { address, limit };
  if (opts.before) {
    params.beforeTs = opts.before.timestamp;
    params.beforeHash = opts.before.txHash;
  }
  if (opts.fromTs) params.fromTs = opts.fromTs;
  if (opts.toTs) params.toTs = opts.toTs;

  const rows = await query<AccountTxRow>(
    `SELECT
        tx_hash,
        toString(transactions.timestamp) AS timestamp,
        toUInt32(toUnixTimestamp(transactions.timestamp) - ${XRPL_EPOCH_OFFSET_S}) AS xrpl_date,
        ledger_index,
        tx_json,
        meta_json
     FROM transactions
     WHERE account = {address:String}
       ${cursorClause}
       ${fromClause}
       ${toClause}
     ORDER BY transactions.timestamp DESC, tx_hash DESC
     LIMIT {limit:UInt16}`,
    params,
  );

  const items: AccountTxItem[] = rows.map((r) => ({
    tx: overlayTxFields(safeParseObject(r.tx_json), r),
    meta: safeParseObject(r.meta_json),
    validated: true,
    timestamp: r.timestamp,
  }));

  // Next cursor — the oldest row in this page (or null if fewer than
  // `limit` rows came back, meaning we hit the end of history).
  const nextCursor =
    rows.length === limit
      ? { timestamp: rows[rows.length - 1].timestamp, txHash: rows[rows.length - 1].tx_hash }
      : null;

  // Latest ledger seen for this account — what the page renders as
  // "as of ledger N". The first row is the newest by ORDER BY.
  const asOfLedger = rows.length > 0 ? rows[0].ledger_index : null;

  return { items, nextCursor, asOfLedger };
}

/* ── Ancestry (earliest tx) ─────────────────────────────────────────── */

interface AncestryRow extends Record<string, unknown> {
  tx_hash: string;
  from_account: string;
  amount_drops: string;
  ledger_index: number;
  xrpl_date: number;
}

export interface AccountAncestry {
  parentAddress: string | null;
  /** XRPL `date` (seconds since 2000-01-01 UTC). */
  activationDate: number | null;
  /** Drops as a string (matches the rippled `Amount` field for XRP). */
  fundingAmount: string | null;
  activationHash: string | null;
  activationLedgerIndex: number | null;
  activationTxIndex: number | null;
}

/**
 * Earliest inbound Payment to an account — the activation tx that
 * created the AccountRoot. Used to populate the ancestry card on the
 * account page (parent address + funding amount + activation date).
 *
 * Reads from `value_transfer_events` (ORDER BY `(to_account, timestamp,
 * ...)`), filtered to `transfer_kind = 'payment'`. The activation is
 * canonically a Payment, so filtering to that kind skips later inbound
 * value transfers (`account_delete`, `check_cash`, `clawback`,
 * `payment_source` per `TRANSFER_KINDS` in the ingester) that aren't
 * activations. AMM and Escrow flows do NOT appear in VTE — they live
 * in `amm_state_changes` and dedicated tables — so we don't need to
 * exclude them here.
 *
 * VTE only stores `tesSUCCESS` events, so failed Payments don't appear
 * and can't be misread as activations.
 *
 * Returns `null` when no activation Payment is found in CH (activation
 * predates the backfill window, or the account was funded by a
 * non-Payment kind that we don't treat as canonical activation).
 *
 * `activationTxIndex` is best-effort — `value_transfer_events` doesn't
 * carry it directly. TODO(slice-2): follow-up lookup against
 * `transactions` by tx_hash (cheap with `idx_tx_hash`) to fill the
 * field for the activation card.
 */
export async function getAncestry(address: string): Promise<AccountAncestry | null> {
  const rows = await query<AncestryRow>(
    `SELECT
        tx_hash,
        from_account,
        amount_drops,
        ledger_index,
        toUInt32(toUnixTimestamp(timestamp) - ${XRPL_EPOCH_OFFSET_S}) AS xrpl_date
     FROM value_transfer_events
     WHERE to_account = {address:String}
       AND transfer_kind = 'payment'
     ORDER BY timestamp ASC, tx_hash ASC
     LIMIT 1`,
    { address },
  );
  if (rows.length === 0) return null;
  const r = rows[0];

  return {
    parentAddress: r.from_account,
    activationDate: r.xrpl_date,
    fundingAmount: r.amount_drops, // drops as a string, matches rippled `Amount`
    activationHash: r.tx_hash,
    activationLedgerIndex: r.ledger_index,
    activationTxIndex: null,
  };
}

/* ── Activations BY this account ─────────────────────────────────── */

/** Single account this address activated (funded into existence). */
export interface AccountActivation extends Record<string, unknown> {
  /** Address of the activated account. */
  activatedAddress: string;
  /** XRPL `date` of the activation Payment. */
  date: number;
  /** Funding amount in drops, as a string (matches rippled `Amount`). */
  amount: string;
  /** Activation Payment hash. */
  hash: string;
}

interface ActivationCandidateRow extends Record<string, unknown> {
  tx_hash: string;
  amount_drops: string;
  xrpl_date: number;
  meta_json: string;
}

/**
 * Lifetime activations BY this account — every Payment from `address`
 * whose meta carries a `CreatedNode` of `LedgerEntryType: AccountRoot`,
 * meaning the Payment created a new account. Replaces the legacy
 * "scan AffectedNodes in the loaded tx window" derivation that capped
 * out at whatever happened to be in the latest 20-50 txs.
 *
 * Why not VTE: the value_transfer_events table has a short backfill
 * window (started 2026-04-28). Using "earliest VTE row's funder" as
 * the activator silently false-positives whenever an older account
 * (activated pre-backfill) receives any post-backfill Payment from
 * `address` — making 1-drop spam look like an activation.
 *
 * The `transactions` table backfill is much wider (12 months) and we
 * read meta_json directly, so we identify the actual CreatedNode
 * AccountRoot signature — same logic as the original in-meta walk,
 * just at full backfill scope instead of the loaded tx window.
 *
 * Performance: `account = X` is the PK first column → partition prune.
 * The two `positionUTF8` filters on meta_json are evaluated only on
 * pruned rows. Activations are a small fraction of an account's
 * Payment txs, so the LIMIT cuts the result set fast.
 *
 * The activated-account address is parsed from meta_json in JS rather
 * than via a CH regex — meta blobs are bounded, the parse is cheap,
 * and it dodges fragile regex/JSON-layout assumptions.
 */
export async function getAccountActivations(
  address: string,
  limit = 500,
): Promise<AccountActivation[]> {
  const rows = await query<ActivationCandidateRow>(
    `SELECT
       tx_hash,
       toString(amount_drops)                                            AS amount_drops,
       toUInt32(toUnixTimestamp(timestamp) - ${XRPL_EPOCH_OFFSET_S})     AS xrpl_date,
       meta_json
     FROM transactions
     WHERE account = {address:String}
       AND tx_type = 'Payment'
       AND result = 'tesSUCCESS'
       AND positionUTF8(meta_json, '"LedgerEntryType":"AccountRoot"') > 0
       AND positionUTF8(meta_json, '"CreatedNode"') > 0
     ORDER BY timestamp DESC
     LIMIT {limit:UInt16}`,
    { address, limit },
  );

  const activations: AccountActivation[] = [];
  for (const r of rows) {
    const activatedAddress = extractActivatedAccount(r.meta_json);
    if (!activatedAddress) continue;
    activations.push({
      activatedAddress,
      date: r.xrpl_date,
      amount: r.amount_drops,
      hash: r.tx_hash,
    });
  }
  return activations;
}

/** Walk a Payment's meta.AffectedNodes for the CreatedNode whose
 *  LedgerEntryType is AccountRoot, return its NewFields.Account.
 *  The CH prefilter is approximate (it matches the same strings in
 *  ModifiedNode payloads too), so this parse is the correctness gate. */
function extractActivatedAccount(metaJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(metaJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const affected = (parsed as { AffectedNodes?: unknown }).AffectedNodes;
  if (!Array.isArray(affected)) return null;
  for (const node of affected) {
    if (!node || typeof node !== "object") continue;
    const created = (node as { CreatedNode?: unknown }).CreatedNode;
    if (!created || typeof created !== "object") continue;
    const c = created as {
      LedgerEntryType?: unknown;
      NewFields?: { Account?: unknown };
    };
    if (c.LedgerEntryType !== "AccountRoot") continue;
    const acct = c.NewFields?.Account;
    if (typeof acct === "string" && acct.startsWith("r")) return acct;
  }
  return null;
}

/* ── NFTs minted by an account ─────────────────────────────────────── */

export interface MintedNftRow extends Record<string, unknown> {
  /** NFTokenID — full 64-char hex. */
  nft_id: string;
  /** Optional URI hex from the NFTokenMint tx body. May be empty when
   *  the mint had no URI. */
  uri: string;
  /** Mint tx hash, for "minted in tx X" linkage. */
  tx_hash: string;
  /** XRPL `date` of the mint tx — seconds since 2000-01-01 UTC. */
  date: number;
  /** Ledger index the mint landed in. */
  ledger_index: number;
}

interface MintedRawRow extends Record<string, unknown> {
  meta_json: string;
  tx_json: string;
  tx_hash: string;
  xrpl_date: number;
  ledger_index: number;
}

/**
 * Lifetime NFTs minted BY this account — every successful NFTokenMint
 * tx where `account = address`. Pulled from `transactions` (PK leads
 * with account, so this is a partition prune + range scan, sub-100ms
 * even for prolific minters).
 *
 * Returns the resulting NFTokenID parsed out of `meta.nftoken_id` (the
 * convenience field rippled / Clio populate on every NFTokenMint), plus
 * the URI from the tx body when present.
 *
 * Note on delegation: this is the tx-level reading — NFTs whose mint
 * transaction was signed by `address`. When `address` is acting as an
 * authorized minter on behalf of another account (NFTokenMinter
 * delegation), the resulting NFTs carry the OTHER account as Issuer,
 * but the mint tx itself is by `address` and shows up here. That
 * matches user intuition for "NFTs I minted."
 *
 * Bounded by the `transactions` backfill window (12 months). Older
 * mints that pre-date ingestion don't appear.
 */
export async function getAccountMintedNfts(
  address: string,
  limit = 5000,
): Promise<MintedNftRow[]> {
  const rows = await query<MintedRawRow>(
    `SELECT
       meta_json,
       tx_json,
       tx_hash,
       toUInt32(toUnixTimestamp(timestamp) - ${XRPL_EPOCH_OFFSET_S}) AS xrpl_date,
       ledger_index
     FROM transactions
     WHERE account = {address:String}
       AND tx_type = 'NFTokenMint'
       AND result = 'tesSUCCESS'
     ORDER BY timestamp DESC
     LIMIT {limit:UInt16}`,
    { address, limit },
  );

  const out: MintedNftRow[] = [];
  for (const row of rows) {
    const meta = safeParseObject(row.meta_json);
    const nftId = (meta.nftoken_id as string | undefined) ?? "";
    if (!nftId || nftId.length !== 64) continue;
    const tx = safeParseObject(row.tx_json);
    const uri = (tx.URI as string | undefined) ?? "";
    out.push({
      nft_id: nftId,
      uri,
      tx_hash: row.tx_hash,
      date: row.xrpl_date,
      ledger_index: row.ledger_index,
    });
  }
  return out;
}

/* ── Incoming NFT offers (active state, indexed) ───────────────────── */

/** Single incoming buy offer on an NFT this account owns. */
export interface IncomingNftOfferRow extends Record<string, unknown> {
  nft_offer_index: string;
  nft_id: string;
  /** Address of the offerer (NOT this account). */
  owner: string;
  /** XRP drops as a string when XRP, "0" when IOU. */
  amount_drops: string;
  /** IOU value as a decimal string when IOU, "" when XRP. */
  amount_iou: string;
  /** Currency code or "XRP". */
  currency: string;
  /** Issuer address; "" for XRP. */
  issuer: string;
  /** Restricted-offer destination, "" otherwise. */
  destination: string;
  /** XRPL `date`-style seconds-since-2000 expiration. 0 = no expiry. */
  expiration_xrpl: number;
  /** Bit-flags from the original NFTokenOffer ledger entry. */
  flags: number;
}

/**
 * NFT buy offers OTHER accounts have placed on NFTs this account owns.
 *
 * Replaces the per-NFT browser fan-out previously used by OffersTab
 * Incoming (which fired N parallel `nft_buy_offers` WS calls and capped
 * at 50 NFTs). Backed by the `nft_offers` + `nft_ownership` state
 * tables populated by the live ingester + the historical backfill.
 *
 * Query plan:
 *   1. nft_ownership lookup — find every NFT id owned by `address`
 *      (and not burned). Bloom filter on owner prunes hard; this is a
 *      sub-millisecond range scan even on millions of NFT rows.
 *   2. nft_offers IN-list filter — for each owned nft_id, find active
 *      buy offers (closed_ledger = 0, owner != address, expiration not
 *      yet hit). Bloom filter on nft_id (0.001 FPP / GRANULARITY 1)
 *      prunes the table fast.
 *
 * No fan-out, no per-NFT round-trips. Sub-100ms regardless of NFT count.
 */
export async function getIncomingNftOffers(
  address: string,
  limit = 1000,
): Promise<IncomingNftOfferRow[]> {
  const nowXrplDate = Math.floor(Date.now() / 1000) - XRPL_EPOCH_OFFSET_S;
  return query<IncomingNftOfferRow>(
    `WITH owned_nfts AS (
       SELECT nft_id
       FROM nft_ownership FINAL
       WHERE owner = {address:String}
         AND is_burned = 0
     )
     SELECT
       nft_offer_index,
       nft_id,
       owner,
       toString(amount_drops)                                AS amount_drops,
       amount_iou,
       currency,
       issuer,
       destination,
       expiration_xrpl,
       flags
     FROM nft_offers FINAL
     WHERE nft_id IN (SELECT nft_id FROM owned_nfts)
       AND closed_ledger = 0
       AND (flags = 0 OR bitAnd(flags, 1) = 0)
       AND owner != {address:String}
       AND (expiration_xrpl = 0 OR expiration_xrpl > {nowXrpl:UInt32})
     ORDER BY created_timestamp DESC
     LIMIT {limit:UInt16}`,
    { address, limit, nowXrpl: nowXrplDate },
  );
}

/** Total NFTs owned by an account in our index (excludes burned). Used
 *  by the offers endpoint to surface "showing offers on N NFTs" status
 *  without an extra round-trip on the consumer. */
export async function getNftOwnedCount(address: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT toString(count()) AS count
     FROM nft_ownership FINAL
     WHERE owner = {address:String}
       AND is_burned = 0`,
    { address },
  );
  return rows.length > 0 ? parseInt(rows[0].count, 10) : 0;
}

/* ── Account tx counts ─────────────────────────────────────────────── */

interface AccountTxCountsRow extends Record<string, unknown> {
  sent_count: string;
  received_count: string;
  first_seen_ledger: string;
  last_seen_ledger: string;
}

export interface AccountTxCounts {
  sentCount: number;
  receivedCount: number;
  /** Earliest ledger this account was observed in. Null when no
   *  observations exist (account isn't tracked in any CH source). */
  firstSeenLedger: number | null;
  /** Latest ledger. Null when no observations. */
  lastSeenLedger: number | null;
}

/**
 * Per-account lifetime tx counts (sent + received), plus first/last
 * seen ledger. Replaces the PG `account_tx_counts` reader (Phase 2 of
 * the PG → CH migration, 2026-05-09).
 *
 * Backed by `account_tx_counts` AggregatingMergeTree in CH, populated
 * by:
 *   - PG snapshot bootstrap (one-shot pipe, captures pre-CH-retention
 *     lifetime activity that the CH tx feed can't reconstruct).
 *   - Two MVs: from `transactions` (sender side) and
 *     `value_transfer_events` (receiver side), continuing forward.
 *
 * SimpleAggregateFunction merge semantics mean we GROUP BY account at
 * read time to fold across unmerged parts. PK lookup on `account` —
 * sub-millisecond regardless of the table's overall size.
 *
 * `first_seen_ledger` uses `UInt32_MAX` (4294967295) as the sentinel
 * for "not yet seen" (PG NULL coalesce → that value). When emitting,
 * we map the sentinel back to null so consumers see the original
 * "unknown" semantics.
 */
const FIRST_SEEN_SENTINEL = 4294967295;

export async function getAccountTxCounts(
  address: string,
): Promise<AccountTxCounts | null> {
  const rows = await query<AccountTxCountsRow>(
    `SELECT
       toString(sum(sent_count))           AS sent_count,
       toString(sum(received_count))       AS received_count,
       toString(min(first_seen_ledger))    AS first_seen_ledger,
       toString(max(last_seen_ledger))     AS last_seen_ledger
     FROM account_tx_counts
     WHERE account = {address:String}
     GROUP BY account`,
    { address },
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const firstSeen = parseInt(r.first_seen_ledger, 10);
  const lastSeen = parseInt(r.last_seen_ledger, 10);
  return {
    sentCount: parseInt(r.sent_count, 10) || 0,
    receivedCount: parseInt(r.received_count, 10) || 0,
    firstSeenLedger:
      Number.isFinite(firstSeen) && firstSeen !== FIRST_SEEN_SENTINEL
        ? firstSeen
        : null,
    lastSeenLedger:
      Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : null,
  };
}

interface OwnedNftValuationRow extends Record<string, unknown> {
  nft_id: string;
  acquired_timestamp: string;
  uri: string;
  highest_xrp_bid_drops: string;
}

export interface OwnedNftValuation {
  nftId: string;
  acquiredTimestamp: string;
  /** Hex-encoded URI from the original NFTokenMint, or empty string
   *  when the mint predates our backfill (or had no URI to begin
   *  with). The metadata-batch resolver falls back to `nft_info`
   *  (Clio) for empty cases so consumers don't need to handle the
   *  gap themselves. */
  uri: string;
  /** Largest active XRP-denominated buy offer, in drops. "0" if no
   *  current offer (LEFT JOIN nulls coalesce to 0 in CH). */
  highestXrpBidDrops: string;
}

/**
 * All NFTs an account owns, joined with the highest active XRP buy
 * offer per NFT. Replaces the rippled fan-out the portfolio NFT route
 * was doing — paginate-all `account_nfts` (up to 50 pages) followed by
 * a per-NFT `nft_buy_offers` call in 10-batches with a 500ms sleep
 * between them (so 100 NFTs = 5s artificial floor + the WS round-trips).
 *
 * Single CH query. Every NFT owned shows up in the result; bid is "0"
 * when no current XRP buy offer exists. Issuer + taxon for grouping
 * are decoded from the nft_id client-side via `parseNFTokenID`.
 *
 * Buy-offer filter:
 *   - `closed_ledger = 0`     → still active
 *   - `bitAnd(flags, 1) = 0`  → flag bit 0 is `lsfSellNFToken`; clear means buy
 *   - `owner != {address}`    → exclude any self-listings
 *   - `expiration_xrpl > now` → not expired (or no expiration set)
 *   - `currency = 'XRP'`      → only XRP-denominated for valuation math
 */
export async function getAccountOwnedNftValuations(
  address: string,
): Promise<OwnedNftValuation[]> {
  const nowXrplDate = Math.floor(Date.now() / 1000) - XRPL_EPOCH_OFFSET_S;
  const rows = await query<OwnedNftValuationRow>(
    `WITH owned AS (
       SELECT nft_id, acquired_timestamp
       FROM nft_ownership FINAL
       WHERE owner = {address:String} AND is_burned = 0
     ),
     bids AS (
       SELECT nft_id, toString(max(amount_drops)) AS highest_drops
       FROM nft_offers FINAL
       WHERE nft_id IN (SELECT nft_id FROM owned)
         AND closed_ledger = 0
         AND (flags = 0 OR bitAnd(flags, 1) = 0)
         AND owner != {address:String}
         AND (expiration_xrpl = 0 OR expiration_xrpl > {nowXrpl:UInt32})
         AND currency = 'XRP'
       GROUP BY nft_id
     ),
     meta AS (
       SELECT nft_id, argMax(uri, last_updated) AS uri
       FROM nft_static_metadata
       WHERE nft_id IN (SELECT nft_id FROM owned)
       GROUP BY nft_id
     )
     SELECT
       owned.nft_id                                     AS nft_id,
       toString(owned.acquired_timestamp)               AS acquired_timestamp,
       coalesce(meta.uri, '')                           AS uri,
       coalesce(bids.highest_drops, '0')                AS highest_xrp_bid_drops
     FROM owned
     LEFT JOIN bids ON owned.nft_id = bids.nft_id
     LEFT JOIN meta ON owned.nft_id = meta.nft_id`,
    { address, nowXrpl: nowXrplDate },
  );
  return rows.map((r) => ({
    nftId: r.nft_id,
    acquiredTimestamp: r.acquired_timestamp,
    uri: r.uri,
    highestXrpBidDrops: r.highest_xrp_bid_drops,
  }));
}

/* ── Trustlines (state-mirror read) ─────────────────────────────────── */

interface TrustLineRowCH extends Record<string, unknown> {
  counterparty: string;
  currency: string;
  balance_value: string;
  account_limit: string;
  counterparty_limit: string;
  flags: number;
  is_lp: number;
  is_burned: number;
}

/**
 * Rippled-shaped TrustLine — matches the consumer interface used by
 * `TrustLineList`, `partitionTrustLines`, and the AMM helpers. We
 * synthesize this from CH `trustlines` rows so existing perspective math
 * (`isHigh = HighLimit.issuer === address`) returns identical output
 * without any consumer-side changes.
 *
 * Convention: we always emit the queried account as the LowLimit side,
 * which means:
 *   - `isHigh` resolves to `false` for every row,
 *   - `Balance.value` is read as-is (no sign flip),
 *   - which matches our CH `balance_value` sign convention (positive =
 *     account holds tokens).
 */
export interface TrustLineFromCH {
  LedgerEntryType: "RippleState";
  Balance: { value: string; currency: string; issuer: string };
  LowLimit: { value: string; currency: string; issuer: string };
  HighLimit: { value: string; currency: string; issuer: string };
  Flags: number;
  /** Convenience flags surfaced from the row — consumers don't strictly
   *  need them, but they're cheaper than re-deriving from currency. */
  is_lp: boolean;
  is_burned: boolean;
}

/**
 * All current trustlines for an account, served from the CH `trustlines`
 * state mirror. Replaces the rippled `account_objects` paginate-all loop
 * for whale accounts with 10k+ trustlines (Sologenic-class). Top-3
 * portfolio-route hotspots paginate-all `account_objects` primarily for
 * trustline data — this function covers them all.
 *
 * `FINAL` is required for read accuracy during ongoing ingestion: when
 * an account modifies a trustline twice in the same merge window, we
 * need the latest version. Per-account scans hit the leading PK column
 * (`account, currency, counterparty`) so FINAL's overhead is bounded
 * to the account's slice — typical accounts have 10s–100s of rows.
 *
 * `is_burned = 0` excludes deleted trustlines (AccountDelete or
 * trust-line-zeroing TrustSet that closes the line).
 */
export async function getAccountTrustLines(
  address: string,
): Promise<TrustLineFromCH[]> {
  if (!address.startsWith("r")) return [];
  const rows = await query<TrustLineRowCH>(
    `SELECT
        counterparty,
        currency,
        balance_value,
        account_limit,
        counterparty_limit,
        flags,
        is_lp,
        is_burned
     FROM trustlines FINAL
     WHERE account = {address:String}
       AND is_burned = 0`,
    { address },
  );
  return rows.map((r) => ({
    LedgerEntryType: "RippleState" as const,
    Balance: {
      value: r.balance_value,
      currency: r.currency,
      issuer: "",
    },
    LowLimit: {
      value: r.account_limit,
      currency: r.currency,
      issuer: address,
    },
    HighLimit: {
      value: r.counterparty_limit,
      currency: r.currency,
      issuer: r.counterparty,
    },
    Flags: r.flags,
    is_lp: r.is_lp === 1,
    is_burned: r.is_burned === 1,
  }));
}

/* ── JSON parsing helper ────────────────────────────────────────────── */

/** Tolerant JSON.parse — returns `{}` on bad input rather than throwing.
 *  Stored blobs come from the ingester's JSON.stringify, so they're well-
 *  formed in practice; this guards against any tier-blob edge cases. */
function safeParseObject(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Overlay the canonical tx fields from CH columns onto the parsed
 *  `tx_json` blob. The blob is the source of truth for tx semantics
 *  (Amount, Sequence, etc.) but doesn't always carry `date`, `hash`,
 *  or `ledger_index` consistently — those are stamped onto the row at
 *  ingest time and read back from the columnar fields. Without this
 *  overlay, `tx.date` is undefined for tx-list rows and downstream
 *  consumers (cursor reconstruction, date column rendering) silently
 *  break. Same overlay pattern is applied in `getTxByHash`. */
function overlayTxFields(
  parsed: Record<string, unknown>,
  row: { tx_hash: string; ledger_index: number; xrpl_date: number },
): Record<string, unknown> {
  return {
    ...parsed,
    hash: row.tx_hash,
    ledger_index: row.ledger_index,
    date: row.xrpl_date,
  };
}

/* ── Txs for a ledger ───────────────────────────────────────────────── */

/** Lightweight row shape used by ledger-page transaction lists. Mirrors
 *  the `RecentTx` shape that the ledger-page UI consumes. */
export interface LedgerTransaction {
  hash: string;
  type: string;
  account: string;
  destination?: string;
  amount?: string;
  fee: string;
  result: string;
  /** XRPL `date` (seconds since 2000-01-01 UTC). */
  date: number;
  ledgerIndex: number;
}

/**
 * All transactions in a ledger, ordered by sequence (we proxy via
 * timestamp + tx_hash since CH doesn't store the ledger-index position).
 * Returns `[]` when the ledger predates the backfill window — caller can
 * fall back to rippled if it cares about the gap.
 */
export async function getTxsForLedger(ledgerIndex: number): Promise<LedgerTransaction[]> {
  if (!Number.isFinite(ledgerIndex) || ledgerIndex < 1) return [];
  const rows = await query<TxRowForLedger>(
    `SELECT
        tx_hash,
        tx_type,
        account,
        destination,
        amount_drops,
        amount_iou,
        currency,
        issuer,
        fee_drops,
        ledger_index,
        toUInt32(toUnixTimestamp(timestamp) - ${XRPL_EPOCH_OFFSET_S}) AS xrpl_date,
        result
     FROM transactions
     WHERE ledger_index = {ledger:UInt32}
     ORDER BY timestamp ASC, tx_hash ASC`,
    { ledger: ledgerIndex },
  );
  return rows.map((r) => ({
    hash: r.tx_hash,
    type: r.tx_type,
    account: r.account,
    destination: r.destination || undefined,
    // Prefer drops when present (Payment/AccountSet/etc. with XRP);
    // fall back to the IOU string for token-denominated amounts. This
    // matches what the existing UI already renders from rippled.
    amount: r.amount_drops && r.amount_drops !== "0" ? r.amount_drops : r.amount_iou || undefined,
    fee: String(r.fee_drops),
    result: r.result,
    date: r.xrpl_date,
    ledgerIndex: r.ledger_index,
  }));
}

/* ── Received txs (receiver-side via value_transfer_events) ─────────── */

/**
 * Most recent value transfers DELIVERED TO an account, descending by
 * timestamp. Two-stage query:
 *   1. `value_transfer_events` (ORDER BY `(to_account, timestamp, ...)`)
 *      → top-N DISTINCT tx_hashes for this receiver. GROUP BY tx_hash
 *      because VTE has multiple rows per tx for cross-currency (one
 *      `payment` + one `payment_source`) and dual-asset shapes — without
 *      the dedup, the inner LIMIT eats N rows but yields fewer than N
 *      distinct hashes, silently shrinking the page.
 *   2. `transactions` (`idx_tx_hash` bloom) → reconstruct rippled-shaped
 *      `{ tx, meta, validated }` items from `tx_json` / `meta_json`.
 *
 * Covers Payment (delivered side) + AccountDelete + CheckCash + Clawback
 * — the populated `TRANSFER_KINDS` in VTE per the ingester. AMMDeposit /
 * AMMWithdraw are NOT in VTE; they live in `amm_state_changes`.
 *
 * Returns the same `AccountTxsResult` shape as `getTxsForAccount` so the
 * account-page consumer can merge sender + receiver streams uniformly.
 */
export async function getReceivedTxsForAccount(
  address: string,
  opts: {
    limit?: number;
    before?: AccountTxCursor;
    fromTs?: string;
    toTs?: string;
  } = {},
): Promise<AccountTxsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  // All VTE rows for a given tx share the same `timestamp` (ledger
  // close_time), so the cursor in WHERE filters whole txs cleanly even
  // before the GROUP BY collapses them.
  const cursorClause = opts.before
    ? `AND (timestamp, tx_hash) < ({beforeTs:DateTime}, {beforeHash:String})`
    : "";
  // Same range bounds as the sender side — applied to the inner VTE
  // scan so the outer `transactions` lookup only sees hashes that already
  // fall inside the window. Adding the bounds to the outer scan too
  // would be redundant; the IN-list does the filtering.
  const fromClause = opts.fromTs ? `AND timestamp >= {fromTs:DateTime}` : "";
  const toClause = opts.toTs ? `AND timestamp <= {toTs:DateTime}` : "";
  const params: Record<string, unknown> = { address, limit };
  if (opts.before) {
    params.beforeTs = opts.before.timestamp;
    params.beforeHash = opts.before.txHash;
  }
  if (opts.fromTs) params.fromTs = opts.fromTs;
  if (opts.toTs) params.toTs = opts.toTs;

  // Inner subquery: GROUP BY tx_hash so the LIMIT counts distinct
  // transactions, not VTE rows. `any(timestamp)` works because all rows
  // for one tx_hash share a timestamp; `any` is cheaper than max.
  // Self-edge filter `from_account != account` is defensive — the
  // ingester drops self-transfers (intel-ingestion.ts), so it's a
  // no-op in practice but cheap and locks in the contract.
  const rows = await query<AccountTxRow>(
    `SELECT
        tx_hash,
        toString(timestamp) AS timestamp,
        toUInt32(toUnixTimestamp(timestamp) - ${XRPL_EPOCH_OFFSET_S}) AS xrpl_date,
        ledger_index,
        tx_json,
        meta_json
     FROM transactions
     WHERE tx_hash IN (
       SELECT tx_hash
       FROM value_transfer_events
       WHERE to_account = {address:String}
         AND from_account != {address:String}
         ${cursorClause}
         ${fromClause}
         ${toClause}
       GROUP BY tx_hash
       ORDER BY any(timestamp) DESC, tx_hash DESC
       LIMIT {limit:UInt16}
     )
     ORDER BY timestamp DESC, tx_hash DESC
     LIMIT {limit:UInt16}`,
    params,
  );

  const items: AccountTxItem[] = rows.map((r) => ({
    tx: overlayTxFields(safeParseObject(r.tx_json), r),
    meta: safeParseObject(r.meta_json),
    validated: true,
    timestamp: r.timestamp,
  }));

  const nextCursor =
    rows.length === limit
      ? { timestamp: rows[rows.length - 1].timestamp, txHash: rows[rows.length - 1].tx_hash }
      : null;
  const asOfLedger = rows.length > 0 ? rows[0].ledger_index : null;

  return { items, nextCursor, asOfLedger };
}

/* ── Affected txs (AffectedNodes-only via account_tx_index) ─────────── */

/**
 * Most recent transactions where the account appears ONLY through
 * `meta.AffectedNodes` — offer crossings, AMM LP movement,
 * trustline-peer side effects, indirect AccountRoot mods. Slice 5a's
 * extractor populates `account_tx_index` with these rows on every new
 * tx; slice 5b's backfill seeds the historical window. Sender +
 * destination are intentionally excluded by the extractor (they'd live
 * in `transactions` PK / `value_transfer_events` already), so a tx
 * returned here is genuinely "this account was touched but didn't send
 * or directly receive value."
 *
 * Two-stage query, same shape as `getReceivedTxsForAccount`:
 *   1. `account_tx_index` (PK `(account, timestamp, tx_hash, role)`)
 *      → top-N DISTINCT tx_hashes for this account. GROUP BY tx_hash
 *      because a single tx can produce multiple roles for the same
 *      account (e.g. an offer crossing that also modifies a trustline
 *      peer); the LIMIT must count distinct txs, not role-rows.
 *   2. `transactions` (`idx_tx_hash` bloom) → reconstruct rippled-shaped
 *      `{ tx, meta, validated }` items.
 *
 * Returns the same `AccountTxsResult` shape as the other two primitives
 * so the merge in `getMergedTxsForAccount` can fold all three sources
 * uniformly.
 */
export async function getAffectedTxsForAccount(
  address: string,
  opts: {
    limit?: number;
    before?: AccountTxCursor;
    fromTs?: string;
    toTs?: string;
  } = {},
): Promise<AccountTxsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  // All `account_tx_index` rows for a given (account, tx_hash) share the
  // same timestamp (the parent tx's close_time), so the cursor filter on
  // (timestamp, tx_hash) is correct even before GROUP BY collapses the
  // multi-role rows.
  const cursorClause = opts.before
    ? `AND (timestamp, tx_hash) < ({beforeTs:DateTime}, {beforeHash:String})`
    : "";
  const fromClause = opts.fromTs ? `AND timestamp >= {fromTs:DateTime}` : "";
  const toClause = opts.toTs ? `AND timestamp <= {toTs:DateTime}` : "";
  const params: Record<string, unknown> = { address, limit };
  if (opts.before) {
    params.beforeTs = opts.before.timestamp;
    params.beforeHash = opts.before.txHash;
  }
  if (opts.fromTs) params.fromTs = opts.fromTs;
  if (opts.toTs) params.toTs = opts.toTs;

  const rows = await query<AccountTxRow>(
    `SELECT
        tx_hash,
        toString(transactions.timestamp) AS timestamp,
        toUInt32(toUnixTimestamp(transactions.timestamp) - ${XRPL_EPOCH_OFFSET_S}) AS xrpl_date,
        ledger_index,
        tx_json,
        meta_json
     FROM transactions
     WHERE tx_hash IN (
       SELECT tx_hash
       FROM account_tx_index
       WHERE account = {address:String}
         ${cursorClause}
         ${fromClause}
         ${toClause}
       GROUP BY tx_hash
       ORDER BY any(timestamp) DESC, tx_hash DESC
       LIMIT {limit:UInt16}
     )
     ORDER BY transactions.timestamp DESC, tx_hash DESC
     LIMIT {limit:UInt16}`,
    params,
  );

  const items: AccountTxItem[] = rows.map((r) => ({
    tx: overlayTxFields(safeParseObject(r.tx_json), r),
    meta: safeParseObject(r.meta_json),
    validated: true,
    timestamp: r.timestamp,
  }));

  const nextCursor =
    rows.length === limit
      ? { timestamp: rows[rows.length - 1].timestamp, txHash: rows[rows.length - 1].tx_hash }
      : null;
  const asOfLedger = rows.length > 0 ? rows[0].ledger_index : null;

  return { items, nextCursor, asOfLedger };
}

/* ── Merged sender + receiver + affected tx history ─────────────────── */

/**
 * Sender + receiver + AffectedNodes-only tx history merged, deduped by
 * tx_hash, sorted by timestamp DESC. Powers the account page's main tx
 * list.
 *
 * Runs all three primitives in parallel — they hit different indexes
 * (`transactions` PK, `value_transfer_events` PK, `account_tx_index`
 * PK) so there's no I/O contention. The extractor in
 * `account-index-extractor.ts` excludes sender + destination from
 * `account_tx_index`, so for any given (tx_hash, account) pair only ONE
 * of the three sources should contain a row — the dedup-by-hash in the
 * merge is a defensive belt-and-suspenders against future extractor
 * changes or self-tx edge cases.
 *
 * `asOfLedger` is the max of the three sides' asOfLedger; `nextCursor`
 * is the cursor of the oldest-merged item if we filled the limit, or
 * `null` when all three sides ran out before the limit. Pagination is
 * approximate at the merge boundary — the next page reuses the cursor
 * against ALL THREE primitives, which can return some overlap. App-side
 * dedup handles the overlap; the cost is up to two extra rows of
 * lookback per page in the worst case. Acceptable for human-paced
 * scrolling.
 */
export async function getMergedTxsForAccount(
  address: string,
  opts: {
    limit?: number;
    before?: AccountTxCursor;
    /** Inclusive lower bound — CH `DateTime` literal `YYYY-MM-DD HH:MM:SS`. */
    fromTs?: string;
    /** Inclusive upper bound — CH `DateTime` literal `YYYY-MM-DD HH:MM:SS`. */
    toTs?: string;
  } = {},
): Promise<AccountTxsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const [sent, received, affected] = await Promise.all([
    getTxsForAccount(address, {
      limit,
      before: opts.before,
      fromTs: opts.fromTs,
      toTs: opts.toTs,
    }),
    getReceivedTxsForAccount(address, {
      limit,
      before: opts.before,
      fromTs: opts.fromTs,
      toTs: opts.toTs,
    }),
    getAffectedTxsForAccount(address, {
      limit,
      before: opts.before,
      fromTs: opts.fromTs,
      toTs: opts.toTs,
    }),
  ]);

  // Dedup by tx hash. The extractor in account-index-extractor.ts
  // excludes sender + destination, so for any (tx_hash, account) pair
  // only one of the three sources should contain a row in practice —
  // this is a defensive belt-and-suspenders. Priority order:
  //   1. sender (`transactions` PK) — canonical record
  //   2. receiver (VTE)
  //   3. affected-nodes (account_tx_index)
  // ensures consistent identity for any future edge case where the
  // same tx legitimately appears in two sources.
  const seen = new Map<string, AccountTxItem>();
  for (const item of sent.items) {
    const hash = (item.tx as { hash?: string }).hash;
    if (hash) seen.set(hash, item);
  }
  for (const item of received.items) {
    const hash = (item.tx as { hash?: string }).hash;
    if (hash && !seen.has(hash)) seen.set(hash, item);
  }
  for (const item of affected.items) {
    const hash = (item.tx as { hash?: string }).hash;
    if (hash && !seen.has(hash)) seen.set(hash, item);
  }
  const merged = Array.from(seen.values()).sort((a, b) => {
    const aDate = (a.tx as { date?: number }).date ?? 0;
    const bDate = (b.tx as { date?: number }).date ?? 0;
    return bDate - aDate;
  });
  const items = merged.slice(0, limit);

  // Cursor uses the merged item's CH `timestamp` field directly (now
  // carried alongside the rippled-shaped tx blob). Earlier this dug
  // through `last.tx.date`, which was undefined because `tx_json`
  // doesn't always serialize that field — silently breaking pagination
  // beyond the first page even on accounts with millions of txs.
  const nextCursor =
    items.length === limit
      ? (() => {
          const last = items[items.length - 1];
          const hash = (last.tx as { hash?: string }).hash;
          if (!hash || !last.timestamp) return null;
          return { timestamp: last.timestamp, txHash: hash };
        })()
      : null;

  const asOfLedger =
    Math.max(
      sent.asOfLedger ?? 0,
      received.asOfLedger ?? 0,
      affected.asOfLedger ?? 0,
    ) || null;

  return { items, nextCursor, asOfLedger };
}

/* ── Initial account history (streamed slot) ────────────────────────── */

/**
 * Bundles `getMergedTxsForAccount` + `getAncestry` into the
 * `InitialAccountHistory` shape consumed client-side by useAccountData /
 * TransactionsTab / useAccountAncestry.
 *
 * Used by the account page server component as a streamed Suspense slot:
 * the page kicks off this fetch but doesn't await it, passes the promise
 * to AccountDataClient, and AccountDataClient suspends only the parts
 * that depend on it (tabs + history-status pill). The page shell —
 * overview card, sidebar, mini-graph — renders immediately.
 *
 * On any CH error the function returns `null` and the client falls back
 * to a rippled `account_tx` call via useAccountData. Same fallback path
 * we had when initialHistory was hardcoded null in the page.
 */
export async function getInitialAccountHistory(
  address: string,
  range: ResolvedRange,
  limit = 50,
): Promise<InitialAccountHistory | null> {
  try {
    const [txs, ancestry] = await Promise.all([
      getMergedTxsForAccount(address, {
        limit,
        fromTs: range.fromTs,
        toTs: range.toTs,
      }),
      getAncestry(address).catch(() => null),
    ]);
    return {
      // AccountTxItem (CH) and AccountTxResult["transactions"] (rippled)
      // are structurally compatible — the shared `{ tx, meta, validated }`
      // surface is what client consumers read. CH adds a `timestamp` field
      // that consumers ignore. Cast through unknown to bridge the type
      // namespaces without touching runtime data.
      transactions: txs.items as unknown as InitialAccountHistory["transactions"],
      nextCursor: txs.nextCursor,
      asOfLedger: txs.asOfLedger,
      ancestry: ancestry
        ? ({
            parentAddress: ancestry.parentAddress,
            activationDate: ancestry.activationDate,
            fundingAmount: ancestry.fundingAmount,
            activationHash: ancestry.activationHash,
            activationLedgerIndex: ancestry.activationLedgerIndex,
            activationTxIndex: ancestry.activationTxIndex,
          } satisfies AncestryData)
        : null,
    };
  } catch {
    return null;
  }
}

/* ── Account synthesis (multi-aggregate scan) ───────────────────────── */

export interface AccountSynthesis {
  /** Sender-side tx count (any tx where this account = `Account` field). */
  sentCount: number;
  /** Receiver-side count (any value transfer where this account = `to_account` in VTE). */
  receivedCount: number;
  /** Lifetime fee paid in drops (sender side, includes failed txs — XRPL burns fee on tec/tef-class failures). */
  feeTotalDrops: string;
  /** XRPL date of earliest tx involving this account (sender side). Null if no tx. */
  firstSeenDate: number | null;
  /** XRPL date of most recent tx (sender side). Null if no tx. */
  lastSeenDate: number | null;
  /** Earliest ledger index seen for this account (sender side). */
  firstLedger: number | null;
  /** Most recent ledger index. */
  lastLedger: number | null;
  /** Tx-type breakdown (sender side), top-N by frequency. */
  typeBreakdown: Array<{ type: string; count: number }>;
  /** DEX trade activity — count of rows where the account appears as taker or maker. */
  dexTradeCount: number;
  /** AMM deposit/withdraw count (sender side OfferCreate/Payment routed through AMMs would also show here). */
  ammActionCount: number;
  /** NFT mint count (sender side). */
  nftMintCount: number;
  /** NFT accept-offer count (sender side, buyer-style). */
  nftAcceptCount: number;
}

/**
 * Per-account synthesis stats. Four parallel queries:
 *   - `transactions` PK scan — sender-side aggregates (count, fees,
 *     first/last seen, AMM/NFT type counts)
 *   - `transactions` GROUP BY tx_type — accurate top-12 type breakdown.
 *     One extra partition-pruned scan; sub-50ms even for whales.
 *   - `value_transfer_events` PK scan — receiver-side count
 *   - `mv_account_counterparty_daily` PK scan — DEX activity count
 *     (sum of dex_count where this account appears). Replaces an
 *     earlier `dex_trades` bloom-OR scan that didn't actually prune
 *     well — `WHERE taker = X OR maker = X` doesn't fire the bloom on
 *     either index for the OR.
 *
 * Each query is partition-pruned for the account, so total latency is
 * `max(query_times)` ~ 50-200ms even for whales.
 *
 * Returns null when the account has zero presence in any source.
 */
export async function getAccountSynthesis(address: string): Promise<AccountSynthesis | null> {
  const [senderRows, typeRows, receiverRows, dexRows] = await Promise.all([
    query<{
      sent_count: string;
      fee_total: string;
      first_date: number | string | null;
      last_date: number | string | null;
      first_ledger: number | string | null;
      last_ledger: number | string | null;
      amm_count: string;
      nft_mint_count: string;
      nft_accept_count: string;
    }>(
      `SELECT
          toString(count())                                                AS sent_count,
          toString(sum(fee_drops))                                         AS fee_total,
          toUInt32(toUnixTimestamp(min(timestamp)) - ${XRPL_EPOCH_OFFSET_S}) AS first_date,
          toUInt32(toUnixTimestamp(max(timestamp)) - ${XRPL_EPOCH_OFFSET_S}) AS last_date,
          min(ledger_index)                                                AS first_ledger,
          max(ledger_index)                                                AS last_ledger,
          toString(countIf(tx_type IN ('AMMDeposit', 'AMMWithdraw', 'AMMCreate', 'AMMVote', 'AMMBid', 'AMMDelete'))) AS amm_count,
          toString(countIf(tx_type = 'NFTokenMint'))                       AS nft_mint_count,
          toString(countIf(tx_type = 'NFTokenAcceptOffer'))                AS nft_accept_count
       FROM transactions
       WHERE account = {address:String}`,
      { address },
    ),
    query<{ tx_type: string; count: string }>(
      `SELECT tx_type, toString(count()) AS count
       FROM transactions
       WHERE account = {address:String}
       GROUP BY tx_type
       ORDER BY count() DESC
       LIMIT 12`,
      { address },
    ),
    query<{ received_count: string }>(
      `SELECT toString(count()) AS received_count
       FROM value_transfer_events
       WHERE to_account = {address:String}
         AND from_account != {address:String}`,
      { address },
    ),
    // dex_count via the seeded MV — sub-millisecond PK lookup vs. the
    // 68M-row dex_trades bloom-OR scan it replaced.
    query<{ dex_count: string }>(
      `SELECT toString(sum(dex_count)) AS dex_count
       FROM mv_account_counterparty_daily
       WHERE account = {address:String}`,
      { address },
    ),
  ]);

  // CH aggregate queries always return one row even on empty result —
  // the no-presence detection happens via the count check below.
  const s = senderRows[0];
  const r = receiverRows[0];
  const d = dexRows[0];

  const sentCount = Number(s?.sent_count) || 0;
  const receivedCount = Number(r?.received_count) || 0;
  const dexCount = Number(d?.dex_count) || 0;
  if (sentCount === 0 && receivedCount === 0 && dexCount === 0) return null;

  const typeBreakdown = typeRows.map((row) => ({
    type: row.tx_type,
    count: Number(row.count) || 0,
  }));

  return {
    sentCount,
    receivedCount,
    feeTotalDrops: s?.fee_total ?? "0",
    firstSeenDate: s?.first_date != null ? Number(s.first_date) : null,
    lastSeenDate: s?.last_date != null ? Number(s.last_date) : null,
    firstLedger: s?.first_ledger != null ? Number(s.first_ledger) : null,
    lastLedger: s?.last_ledger != null ? Number(s.last_ledger) : null,
    typeBreakdown,
    dexTradeCount: dexCount,
    ammActionCount: Number(s?.amm_count) || 0,
    nftMintCount: Number(s?.nft_mint_count) || 0,
    nftAcceptCount: Number(s?.nft_accept_count) || 0,
  };
}

/* ── Account counterparties ─────────────────────────────────────────── */

export interface CounterpartyRow {
  address: string;
  txCount: number;
  paymentCount: number;
  dexTradeCount: number;
  /** Dominant relationship — `payment` if more payments than dex trades, else `dex`. */
  type: "payment" | "dex";
}

/**
 * Top-N counterparties for an account, by total interaction count, via
 * `mv_account_counterparty_daily` (PK `(account, counterparty, day)`,
 * SummingMergeTree). Single partition-pruned scan, sub-millisecond for
 * non-whale accounts, ~tens of ms for whales with thousands of edges.
 *
 * The MV's source views fire from `value_transfer_events` (both sides)
 * and `dex_trades` (both sides) — so a single payment between two
 * accounts produces TWO MV rows (one keyed on each side). `tx_count`
 * here is therefore "edge traversals," not distinct events. Same for
 * the pre-MV UNION fallback this replaces, so values match.
 *
 * Self-edge filter `counterparty != account` matches the pre-MV
 * fallback semantics — the source views only filter empty-string
 * addresses, not self-payments. Consumed by `/api/intel/counterparties`;
 * `intel-graph-features.ts` queries the same MV directly with a
 * different shape (`count(DISTINCT counterparty)` for unique-edge counts).
 */
export async function getAccountCounterparties(
  address: string,
  opts: { limit?: number } = {},
): Promise<CounterpartyRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 50);
  // Aliases are renamed to avoid shadowing the source columns: CH
  // resolves `tx_count` in the ORDER BY against the SELECT alias, and
  // wrapping the sum in toString() would have made that alias a String,
  // breaking `ORDER BY sum(tx_count)` since sum() can't take a String.
  // Distinct alias names sidestep the resolution ambiguity.
  const rows = await query<{
    address: string;
    total_count: number | string;
    payment_total: number | string;
    dex_total: number | string;
  }>(
    `SELECT
       counterparty AS address,
       sum(tx_count)      AS total_count,
       sum(payment_count) AS payment_total,
       sum(dex_count)     AS dex_total
     FROM mv_account_counterparty_daily
     WHERE account = {address:String}
       AND counterparty != {address:String}
     GROUP BY counterparty
     ORDER BY total_count DESC
     LIMIT {limit:UInt16}`,
    { address, limit },
  );

  return rows.map((r) => {
    const payments = Number(r.payment_total) || 0;
    const dex = Number(r.dex_total) || 0;
    return {
      address: r.address,
      txCount: Number(r.total_count) || 0,
      paymentCount: payments,
      dexTradeCount: dex,
      type: payments >= dex ? ("payment" as const) : ("dex" as const),
    };
  });
}

/* ── Account activity heatmap ───────────────────────────────────────── */

export interface ActivityBucket {
  /** Hour bucket as XRPL `date` (seconds since 2000-01-01 UTC). */
  hour: number;
  count: number;
}

/**
 * Hourly activity buckets for the past N days, sender-side. Used by the
 * account page's calendar-grid heatmap.
 *
 * Sender-side from `transactions` PK scan only — keeps the helper
 * cheap. Receiver-side and AffectedNodes-side coverage will fold in via
 * a future helper that unions `value_transfer_events` and (slice 5)
 * `account_tx_index`. For typical visualization purposes (when was
 * this account active? at what daily/weekly cadence?), sender-side
 * captures the dominant signal.
 *
 * Returns hours sorted ascending (oldest first). Empty hours are NOT
 * filled in — caller renders empty cells from the grid template.
 */
export async function getAccountActivityHeatmap(
  address: string,
  opts: { days?: number } = {},
): Promise<ActivityBucket[]> {
  const days = Math.min(Math.max(opts.days ?? 30, 1), 365);
  const rows = await query<{ hour: number | string; count: string }>(
    `SELECT
        toUInt32(toUnixTimestamp(toStartOfHour(timestamp)) - ${XRPL_EPOCH_OFFSET_S}) AS hour,
        toString(count()) AS count
     FROM transactions
     WHERE account = {address:String}
       AND timestamp >= now() - INTERVAL {days:UInt16} DAY
     GROUP BY hour
     ORDER BY hour ASC`,
    { address, days },
  );
  return rows.map((r) => ({ hour: Number(r.hour), count: Number(r.count) || 0 }));
}

/* ── Live behavior tags (CH-derivable) ──────────────────────────────── */

export type BehaviorTag =
  | "dex_trader"
  | "liquidity_provider"
  | "nft_collector"
  | "nft_creator"
  | "cross_currency_payer"
  | "whale"
  | "validator";

/** Subset that comes from the daily smart-money scorer's batch label
 *  derivation — written to PG `account_labels` (see `deriveLegacyLabels`
 *  in `src/lib/smart-money.ts`). The chip strip surfaces these inline
 *  on the account hero alongside the CH-live derivable tags so the
 *  full identity picture is visible without opening the intel sidebar.
 *
 *  Smart-money also writes `profitable_trader`, `market_maker`, and
 *  `early_lp` here — those are intentionally kept as smart-money-tier
 *  signals (rendered in `<SmartMoneyBadges>` instead of as identity
 *  chips). `whale` and `validator` make sense as identity ("this
 *  account IS a whale / a validator"); the others read more as
 *  performance ratings. */
const BATCH_BEHAVIOR_TAGS = new Set<BehaviorTag>(["whale", "validator"]);

/**
 * CH-derivable behavior tags. Returns the subset of tags this account
 * qualifies for via cheap PK-pruned queries.
 *
 * `synth` may be passed in to avoid re-fetching when the page-level
 * loader has already pulled `getAccountSynthesis` for the dashboard
 * card — saves 4 queries per account-page render. When omitted, the
 * helper fetches its own synthesis.
 *
 * Cross-currency detection uses VTE `transfer_kind = 'payment_source'`
 * — emitted by the ingester for the source side of any cross-currency
 * Payment. Catches all three shapes (XRP→IOU, IOU→XRP, IOU→IOU); the
 * earlier `JSONExtractString(tx_json, 'Amount')` approach silently
 * missed the two IOU-source shapes since `JSONExtractString` returns
 * `''` on object-shaped Amount fields.
 *
 * `issuer` is intentionally NOT here. Detecting issuer status from
 * raw tables would require either full table scans (no bloom on
 * `issuer` columns) or a new MV. Slice 3 derives it from rippled's
 * `account_objects` (issuers have trustlines where `LowLimit.issuer`
 * = self) — single WS call, instant, no CH cost. Same path used for
 * the rippled-derived `xrp_holder` / `stablecoin_holder` tags.
 *
 * Batch tags (`arbitrage_bot`, `market_maker_bot`, `validator`,
 * `whale`) come from `account_labels` in slice 6.
 */
export async function getLiveBehaviorTags(
  address: string,
  opts: { synth?: AccountSynthesis | null } = {},
): Promise<BehaviorTag[]> {
  const synth =
    opts.synth !== undefined ? opts.synth : await getAccountSynthesis(address);

  // Batch tags from PG `account_labels` (written by the daily behavior-
  // scorer). Fetched even for dormant CH-side accounts because a tag
  // like `whale` may have qualified historically but the account has
  // since gone quiet. Cheap PK lookup on (address, label).
  const batchTags = await fetchBatchBehaviorTags(address);

  // Short-circuit on dormant accounts (no CH presence) — return any
  // batch tags we found and skip the CH-derivable checks. The synth
  // null check would otherwise drop us through the rest of the function
  // with empty input and make redundant CH queries.
  if (!synth) return batchTags;

  // Cross-currency payer = appears as `from_account` of a
  // `payment_source` transfer kind. The ingester emits exactly one
  // such row per cross-currency Payment (the source side, paired
  // with the `payment` row for the delivered side). VTE has a bloom
  // on `from_account` so this is granule-pruned even though
  // `from_account` isn't the leading PK column. Windowed to the last
  // 90 days for the same recency reasoning as the AMM/NFT tags below.
  const crossCurrencyRows = await query<{
    recent: string;
    lifetime: string;
  }>(
    `SELECT
       toString(countIf(timestamp >= now() - INTERVAL 90 DAY)) AS recent,
       toString(count()) AS lifetime
     FROM value_transfer_events
     WHERE from_account = {address:String}
       AND transfer_kind = 'payment_source'`,
    { address },
  );

  // Recent (90d) activity window — tightens the "this account IS an X"
  // tags to "this account currently behaves like an X." Without this,
  // an account that did 5 NFT accepts in 2024 and zero since reads as
  // "NFT Collector" forever, even after they've sold all their NFTs.
  // Pairs with the lifetime threshold below: tag fires only if BOTH
  // are met. `dex_trader` is split into two queries (synth uses an MV
  // for cheap lifetime totals; recent uses dex_trades direct).
  const recentRows = await query<{
    recent_amm: string;
    recent_nft_accept: string;
    recent_nft_mint: string;
  }>(
    `SELECT
       toString(countIf(tx_type IN ('AMMDeposit','AMMWithdraw','AMMCreate','AMMVote','AMMBid','AMMDelete'))) AS recent_amm,
       toString(countIf(tx_type = 'NFTokenAcceptOffer'))  AS recent_nft_accept,
       toString(countIf(tx_type = 'NFTokenMint'))         AS recent_nft_mint
     FROM transactions
     WHERE account = {address:String}
       AND timestamp >= now() - INTERVAL 90 DAY`,
    { address },
  );
  const recentDexRows = await query<{ recent_dex: string }>(
    `SELECT toString(count()) AS recent_dex
     FROM dex_trades
     WHERE (taker = {address:String} OR maker = {address:String})
       AND timestamp >= now() - INTERVAL 90 DAY`,
    { address },
  );

  const recentAmm = Number(recentRows[0]?.recent_amm ?? 0);
  const recentNftAccept = Number(recentRows[0]?.recent_nft_accept ?? 0);
  const recentNftMint = Number(recentRows[0]?.recent_nft_mint ?? 0);
  const recentDex = Number(recentDexRows[0]?.recent_dex ?? 0);
  const recentCrossCurrency = Number(crossCurrencyRows[0]?.recent ?? 0);

  const tags = new Set<BehaviorTag>(batchTags);
  // Tag fires only when BOTH (lifetime ≥ threshold) AND (≥1 in last
  // 90 days). Lifetime gate keeps the bar high enough that one-off
  // accidental activity doesn't qualify; recency gate keeps the label
  // honest about what the account is doing NOW.
  //
  // AMM threshold raised 1 → 5 — a single AMM action ever (e.g. a
  // one-time bid that didn't win, or a single experimental deposit)
  // shouldn't read as "Liquidity Provider".
  if (synth.dexTradeCount >= 10 && recentDex >= 1) tags.add("dex_trader");
  if (synth.ammActionCount >= 5 && recentAmm >= 1) tags.add("liquidity_provider");
  if (synth.nftAcceptCount >= 5 && recentNftAccept >= 1) tags.add("nft_collector");
  if (synth.nftMintCount >= 5 && recentNftMint >= 1) tags.add("nft_creator");

  if (
    Number(crossCurrencyRows[0]?.lifetime ?? 0) >= 3 &&
    recentCrossCurrency >= 1
  ) {
    tags.add("cross_currency_payer");
  }

  return Array.from(tags);
}

/** Read the batch-derived behavior labels for an account from PG
 *  `account_labels`. Only returns labels the behavior-scorer owns —
 *  the smart-money scorer also writes to this table (`profitable_trader`,
 *  `market_maker`, `early_lp`, etc.) and those have their own surface
 *  via `<SmartMoneyBadges>`. */
async function fetchBatchBehaviorTags(address: string): Promise<BehaviorTag[]> {
  // Lazy-import the db here so this server-only file can still be
  // referenced from other server modules without dragging in PG when
  // they only consume the type exports.
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const rows = await db.execute<{ label: string }>(sql`
    SELECT label FROM account_labels
    WHERE address = ${address}
      AND label IN ('whale', 'validator')
  `);
  const tags: BehaviorTag[] = [];
  for (const r of rows) {
    if (BATCH_BEHAVIOR_TAGS.has(r.label as BehaviorTag)) {
      tags.push(r.label as BehaviorTag);
    }
  }
  return tags;
}
