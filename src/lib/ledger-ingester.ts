/**
 * Unified per-ledger ingester.
 *
 * Replaces the dual `IngestionManager` (PG aggregations) + `IntelIngestionManager`
 * (CH/Neo4j) pipelines with a single `ingestLedger(ctx, ledgerIndex)` entry point.
 * Both the standalone live runner (`scripts/run-ingester.ts`) and the historical
 * backfill (`scripts/backfill-history.ts`, future refactor) call this.
 *
 * Pipeline order (per ledger):
 *   1. Fetch expanded ledger via `ctx.xrpl.getLedger(idx, true)`
 *   2. Classify (intel rows: transactions, dex_trades, trustline_events,
 *      ledger_metadata, amm_state_changes, payments / dex / regular-key Cypher
 *      payloads, account-counter deltas)
 *   3. Walk transactions ONCE collecting:
 *        - fee burn + tx-type counts (BEFORE isSuccess gate — XRPL burns fees
 *          even on tec-class failures)
 *        - payment corridors, NFT trades, token trades (after isSuccess)
 *        - AMM pool mutations (Create/Delete/Vote)
 *        - cost basis + disposal events for tracked accounts
 *        - NFT URI + token-icon backlog
 *   4. ClickHouse dedup probe — `SELECT DISTINCT ledger_index FROM transactions
 *      WHERE ledger_index = {idx:UInt32}`. If it returns a row we still re-run
 *      the PG upserts (which are idempotent), but skip the CH writes.
 *   5. Parallel writes (Promise.allSettled): CH inserts + Neo4j MERGEs
 *   6. Sequential PG upserts: amm_pools, token_metadata, hourly aggregations
 *      (fee_burn, tx_count, payment_corridor, nft_volume, token_volume,
 *      wallet_trade_volume), token_cost_basis, token_realized_pnl,
 *      account_tx_counts (gated on `alreadyWritten`), recent_nft_trades,
 *      ingested_ledgers, ingestion_state pointers.
 *   7. Fire-and-forget post-commit: NFT URI capture, token icon resolve.
 *
 * Crash semantics: on crash mid-PG, restart re-runs the CH dedup probe which
 * skips already-written CH rows; PG upserts are individually idempotent
 * (ON CONFLICT DO UPDATE / DO NOTHING + LEAST/GREATEST guards). The pointer
 * advance (`intel_latest_ledger`) is the last write — if everything before
 * succeeds and the pointer write fails, the next run reprocesses this ledger
 * from scratch but every store dedups.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingestedLedgers,
  ingestionState,
  ammPools,
  tokenMetadata,
  tokenCostBasis,
  tokenRealizedPnl,
} from "@/db/schema";
import logger from "./logger";
import * as ch from "./clickhouse-client";
import { classifyLedger, type ClassifiedLedger } from "./intel-ingestion";
import {
  extractNFTTrade,
  extractTokenTrades,
  extractPaymentCorridor,
} from "./trade-extractors";
import {
  extractNftStateEvents,
  type NftOfferRow,
  type NftOwnershipRow,
  type NftStaticMetadataRow,
} from "./nft-state-extractor";
import {
  extractTrustlineEvents,
  type TrustlineRow,
} from "./trustline-state-extractor";
import {
  extractCostBasisEvents,
  extractDisposalEvents,
  extractXrpCostBasisEvents,
  extractXrpDisposalEvents,
  type CostBasisEvent,
  type DisposalEvent,
} from "./cost-basis-extractor";
import {
  extractAccountTxIndex,
  type AccountTxIndexRow,
} from "./account-index-extractor";
import { recordKnownURI } from "./nft-metadata-resolver";
import { queueTokenIconResolve } from "./token-icon-resolver";
import { getXrpPrice } from "./price-data";
import type { XrplClient } from "./xrpl-client";
import type { ExpandedLedger, RawLedgerTx } from "@/types/ingestion";
import { XRPL_EPOCH } from "./xrpl-helpers";

const log = logger.child({ module: "ledger-ingester" });

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

/**
 * Per-call context passed to `ingestLedger`. Lets the live runner and the
 * future backfill share the same code path while owning their own xrpl
 * client and toggling live-only behaviors (URI capture, icon resolve).
 */
export interface IngestContext {
  /** XRPL client to fetch the expanded ledger. The runner owns lifecycle. */
  xrpl: XrplClient;
  /** Marketplace registry: address -> name (e.g. xrp.cafe broker addresses). */
  marketplaceMap: Map<string, string>;
  /** Tracked accounts (wallets that signed in via xumm/etc) — gates cost
   *  basis + disposal extraction. Pass an empty set on backfill to skip. */
  trackedAccountSet: Set<string>;
  /** Whether to capture NFT URIs (mint inline + nft_info lookups for trades).
   *  Backfill should pass false — historical mints are already resolved. */
  captureNftUris?: boolean;
  /** Whether to queue token icons for resolution. Backfill should pass false. */
  queueTokenIcons?: boolean;
  /** Whether to write to ClickHouse. Default true — set false to dry-run. */
  writeClickHouse?: boolean;
  /** Whether to mutate the `amm_pools` PG table on AMM* txs. Default true.
   *  Backfill should pass false — `amm_pools` is current-state only;
   *  replaying historical AMMCreate from deleted pools corrupts current
   *  state. CH `amm_state_changes` keeps the historical event trail. */
  writeAmmPools?: boolean;
  /** Whether to enrich the `token_metadata` PG table for newly-seen tokens.
   *  Default true. Backfill should pass false — live runner has already
   *  registered every currently-active token; historical-only tokens
   *  rarely matter. */
  writeTokenMetadata?: boolean;
  /** Whether to maintain the `recent_nft_trades` PG rolling buffer (10 most
   *  recent). Default true. Backfill should pass false — by definition
   *  backfill ledgers are not recent. The PG table is also dead weight
   *  post-cutover (CH `nft_trades` is the new source of truth) so this
   *  flag will go away when the table is dropped. */
  writeRecentNftTrades?: boolean;
  /** Whether to record the ledger in PG `ingested_ledgers`. Default true.
   *  Backfill should pass false once gap detection moves to CH
   *  `ledger_metadata`. The PG table is otherwise just a dedup hint. */
  writeIngestedLedgers?: boolean;
  /** Whether to populate `account_tx_index` (slice 5a — AffectedNodes-only
   *  per-account rows). Default true for live; backfill can opt out via
   *  false to avoid amplifying the write volume during a historical
   *  walk before the dedicated `backfill-account-tx-index.ts` job (slice
   *  5b) runs. */
  writeAccountTxIndex?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Find the AMM account address from a CreatedNode in AMMCreate metadata. */
function findCreatedAMMAccount(
  nodes: { CreatedNode?: { LedgerEntryType: string; NewFields?: Record<string, unknown> } }[],
): string | null {
  for (const node of nodes) {
    if (node.CreatedNode?.LedgerEntryType === "AMM") {
      const fields = node.CreatedNode.NewFields;
      if (fields?.Account && typeof fields.Account === "string") return fields.Account;
    }
  }
  return null;
}

/** Find the deleted AMM account address from AMMDelete metadata. */
function findDeletedAMMAccount(
  nodes: { DeletedNode?: { LedgerEntryType: string; FinalFields?: Record<string, unknown> } }[],
): string | null {
  for (const node of nodes) {
    if (node.DeletedNode?.LedgerEntryType === "AMM") {
      const fields = node.DeletedNode.FinalFields;
      if (fields?.Account && typeof fields.Account === "string") return fields.Account;
    }
  }
  return null;
}

/** Find updated trading fee from AMMVote metadata (ModifiedNode on AMM ledger entry). */
function findAMMVoteFeeUpdate(
  nodes: { ModifiedNode?: { LedgerEntryType: string; FinalFields?: Record<string, unknown> } }[],
): { account: string; tradingFee: number } | null {
  for (const node of nodes) {
    if (node.ModifiedNode?.LedgerEntryType === "AMM") {
      const fields = node.ModifiedNode.FinalFields;
      if (
        fields?.Account &&
        typeof fields.Account === "string" &&
        typeof fields.TradingFee === "number"
      ) {
        return { account: fields.Account, tradingFee: fields.TradingFee };
      }
    }
  }
  return null;
}

/** Parse AMMCreate transaction fields into asset pair + trading fee. */
function parseAMMCreateAssets(
  tx: RawLedgerTx,
): { asset1Currency: string; asset1Issuer: string | null; asset2Currency: string; asset2Issuer: string | null; tradingFee: number | null } | null {
  const raw = tx as unknown as Record<string, unknown>;
  const amount = raw.Amount;
  const amount2 = raw.Amount2;
  if (!amount || !amount2) return null;

  function parseAsset(a: unknown): { currency: string; issuer: string | null } | null {
    if (typeof a === "string") return { currency: "XRP", issuer: null };
    if (typeof a === "object" && a !== null) {
      const obj = a as { currency?: string; issuer?: string };
      if (obj.currency) return { currency: obj.currency, issuer: obj.issuer ?? null };
    }
    return null;
  }

  const a1 = parseAsset(amount);
  const a2 = parseAsset(amount2);
  if (!a1 || !a2) return null;

  const tradingFee = typeof raw.TradingFee === "number" ? raw.TradingFee : null;
  return {
    asset1Currency: a1.currency,
    asset1Issuer: a1.issuer,
    asset2Currency: a2.currency,
    asset2Issuer: a2.issuer,
    tradingFee,
  };
}

/* ------------------------------------------------------------------ */
/*  CH row types — new tables introduced by this rewrite               */
/* ------------------------------------------------------------------ */

interface CHNftTrade {
  [key: string]: string | number;
  tx_hash: string;
  ledger_index: number;
  timestamp: string;
  nft_id: string;
  issuer: string;
  taxon: number;
  seller: string;
  buyer: string;
  broker: string;
  marketplace: string;
  amount_drops: number;
  amount_currency: string;
  amount_issuer: string;
  amount_value: string;
  is_xrp: number;
}

interface CHPaymentCorridor {
  [key: string]: string | number;
  tx_hash: string;
  ledger_index: number;
  timestamp: string;
  src_currency: string;
  src_issuer: string;
  dst_currency: string;
  dst_issuer: string;
  /** CH Int64 — sent as decimal string for lossless serialization through
   * JSONEachRow. The previous `number` typing forced a lossy `Number(bigint)`
   * conversion at the call site, dropping precision past 2^53 (~9 quadrillion
   * drops, ~9 trillion XRP). Cohort sums in payment_corridors can exceed
   * that for high-volume tokens, so we keep the BigInt domain end-to-end
   * and serialize as string. */
  xrp_volume_drops: string;
}

/** ClickHouse FixedString(64) requires exactly 64 chars. Pad/truncate hashes. */
function fixedHash(h: string | undefined | null): string {
  const s = (h ?? "").toUpperCase();
  if (s.length === 64) return s;
  return s.padEnd(64, "0").slice(0, 64);
}

/** Clamp a decimal string into Int64 range for CH amount_drops columns.
 *  IOU NFT-trade amounts can have arbitrary precision; we keep `amount_value`
 *  for the original string and use `amount_drops` only as a rough numeric
 *  signal (zero for IOU).
 *
 *  Uses Number domain — lossy past 2^53. For columns where you have a
 *  bigint source (corridor xrp volume sums, etc.) prefer
 *  `clampBigIntToInt64String` below. */
function clampToInt64(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(Math.min(Math.max(n, -9e18), 9e18));
}

/** Int64 wire bounds (matches `INT64_MAX/MIN` in `intel-ingestion.ts` —
 * intentionally duplicated here to avoid a circular import; consolidate
 * into a shared util module if a third site needs it). */
const INT64_MAX_BIGINT = 9_223_372_036_854_775_807n;
const INT64_MIN_BIGINT = -9_223_372_036_854_775_808n;

/** Clamp a bigint into Int64 range and serialize to its decimal string
 *  form. Use for any CH Int64 column when the source is bigint — keeps
 *  full precision through serialization (CH JSONEachRow accepts numeric
 *  strings for Int64 columns and parses them losslessly). */
function clampBigIntToInt64String(value: bigint): string {
  if (value > INT64_MAX_BIGINT) return INT64_MAX_BIGINT.toString();
  if (value < INT64_MIN_BIGINT) return INT64_MIN_BIGINT.toString();
  return value.toString();
}

/* ------------------------------------------------------------------ */
/*  Walk a single ledger and produce all per-store payloads            */
/* ------------------------------------------------------------------ */

interface WalkResult {
  /** Cost-basis events folded across the ledger. */
  costBasisMap: Map<string, CostBasisEvent>;
  /** Disposal events (one row per sale). */
  disposalEvents: DisposalEvent[];
  /** Token pairs touched this ledger (for metadata auto-register + icon queue). */
  newTokenPairs: Set<string>;
  /** AMM pool mutations to apply sequentially. */
  ammMutations: Array<
    | { kind: "create"; account: string; asset1Currency: string; asset1Issuer: string | null; asset2Currency: string; asset2Issuer: string | null; tradingFee: number | null }
    | { kind: "delete"; account: string }
    | { kind: "vote"; account: string; tradingFee: number }
  >;
  /** Recent NFT trades rolling buffer rows. */
  recentTradeRows: Array<{ txHash: string; nftokenId: string; buyer: string; seller: string; amountDrops: bigint | null; date: number | null; ledgerIndex: number }>;
  /** NFT URIs captured inline from NFTokenMint. */
  mintURIs: Array<{ nftokenId: string; uri: string }>;
  /** NFTokenIDs that need an nft_info lookup post-commit. */
  tradeNftIds: string[];
  /** New CH tables: one row per NFT trade. */
  chNftTradeRows: CHNftTrade[];
  /** NFTokenOffer state events — creates + closes (cancel/accept/burn).
   *  ReplacingMergeTree on `nft_offer_index` dedups create+close to the
   *  latest version. Used by the OffersTab Incoming view. */
  chNftOfferRows: NftOfferRow[];
  /** NFT ownership transitions — mints, burns, transfers via accept-offer.
   *  Drives "all NFTs owned by X" → input filter for the offers query. */
  chNftOwnershipRows: NftOwnershipRow[];
  /** NFT static metadata — set-once-at-mint URI, issuer, taxon. Lives
   *  separately from `nft_ownership` because URIs are immutable per
   *  XLS-20 and would otherwise get clobbered by transfer-event
   *  ReplacingMergeTree merges. */
  chNftStaticMetadataRows: NftStaticMetadataRow[];
  /** Trustline state — every RippleState change, denormalized per
   *  perspective. Two rows per ledger entry (one keyed on each side).
   *  ReplacingMergeTree on (account, currency, counterparty) merges
   *  successive updates to a single latest-state row per pair. */
  chTrustlineRows: TrustlineRow[];
  /** New CH tables: one row per qualifying Payment with cross-currency corridor. */
  chPaymentCorridorRows: CHPaymentCorridor[];
  /** AffectedNodes-only per-account rows for `account_tx_index` (slice 5a).
   *  Captures offer crossings, AMM LP changes, trustline peer side effects,
   *  AccountRoot indirect modifications. Sender/destination intentionally
   *  excluded — those live in `transactions` PK + `value_transfer_events`. */
  chAccountTxIndexRows: AccountTxIndexRow[];
  /** Total counts for log line. */
  nftTradeCount: number;
  tokenTradeCount: number;
  corridorCount: number;
  costBasisEventCount: number;
}

function emptyWalk(): WalkResult {
  return {
    costBasisMap: new Map(),
    disposalEvents: [],
    newTokenPairs: new Set(),
    ammMutations: [],
    recentTradeRows: [],
    mintURIs: [],
    tradeNftIds: [],
    chNftTradeRows: [],
    chNftOfferRows: [],
    chNftOwnershipRows: [],
    chNftStaticMetadataRows: [],
    chTrustlineRows: [],
    chPaymentCorridorRows: [],
    chAccountTxIndexRows: [],
    nftTradeCount: 0,
    tokenTradeCount: 0,
    corridorCount: 0,
    costBasisEventCount: 0,
  };
}

function walkTransactions(
  ledger: ExpandedLedger["ledger"],
  ctx: IngestContext,
  xrpPriceUsd: number,
): WalkResult {
  const out = emptyWalk();
  const txs = (ledger.transactions ?? []) as RawLedgerTx[];

  for (let i = 0; i < txs.length; i++) {
    // Shallow-copy so stamping date/ledger_index doesn't mutate cached objects.
    const rawTx = { ...txs[i] };
    if (rawTx.date == null) rawTx.date = ledger.close_time;
    if (rawTx.ledger_index == null) rawTx.ledger_index = ledger.ledger_index;

    const meta = rawTx.meta ?? rawTx.metaData;
    const txResult = meta?.TransactionResult ?? "";
    const isSuccess = txResult === "tesSUCCESS";

    const txDate = rawTx.date ?? ledger.close_time;
    const txDateIso = new Date((txDate + XRPL_EPOCH) * 1000);

    if (!isSuccess) continue;

    /* ── C. Payment corridor — CH `payment_corridors` table, one row per qualifying tx. */
    const corridor = extractPaymentCorridor(rawTx);
    if (corridor) {
      out.corridorCount++;
      out.chPaymentCorridorRows.push({
        tx_hash: fixedHash(rawTx.hash),
        ledger_index: ledger.ledger_index,
        timestamp: new Date(corridor.dateIso).toISOString().replace("T", " ").slice(0, 19),
        src_currency: corridor.srcCurrency,
        src_issuer: corridor.srcIssuer,
        dst_currency: corridor.dstCurrency,
        dst_issuer: corridor.dstIssuer,
        xrp_volume_drops: clampBigIntToInt64String(corridor.xrpVolumeDrops),
      });
    }

    /* ── D. NFT trades */
    const nftTrade = extractNFTTrade(rawTx, ctx.marketplaceMap);
    if (nftTrade) {
      out.nftTradeCount++;

      // Recent-trades buffer (PG, retained during transition).
      out.recentTradeRows.push({
        txHash: nftTrade.txHash,
        nftokenId: nftTrade.nftId,
        buyer: nftTrade.buyer,
        seller: nftTrade.seller,
        amountDrops: nftTrade.isXrp && nftTrade.amountDrops != null ? nftTrade.amountDrops : null,
        date: nftTrade.date,
        ledgerIndex: ledger.ledger_index,
      });

      // URI capture queue (live runner only).
      out.tradeNftIds.push(nftTrade.nftId);

      /* New CH `nft_trades` table — one row per fill, regardless of currency. */
      out.chNftTradeRows.push({
        tx_hash: fixedHash(nftTrade.txHash),
        ledger_index: ledger.ledger_index,
        timestamp: new Date(nftTrade.dateIso).toISOString().replace("T", " ").slice(0, 19),
        nft_id: fixedHash(nftTrade.nftId),
        issuer: nftTrade.issuer,
        taxon: nftTrade.taxon,
        seller: nftTrade.seller,
        buyer: nftTrade.buyer,
        broker: nftTrade.broker ?? "",
        marketplace: nftTrade.marketplace ?? "",
        amount_drops: nftTrade.isXrp && nftTrade.amountDrops != null
          ? clampToInt64(Number(nftTrade.amountDrops))
          : 0,
        amount_currency: nftTrade.isXrp ? "XRP" : (nftTrade.amountCurrency ?? ""),
        amount_issuer: nftTrade.isXrp ? "" : (nftTrade.amountIssuer ?? ""),
        amount_value: nftTrade.isXrp ? "" : (nftTrade.amountValue ?? ""),
        is_xrp: nftTrade.isXrp ? 1 : 0,
      });
    }

    /* ── E. Inline NFTokenMint URI capture. The convenience `nftoken_id` meta
     * field is on modern rippled / Clio. If missing, a later trade triggers
     * the nft_info fallback. */
    if (
      isSuccess &&
      rawTx.TransactionType === "NFTokenMint" &&
      typeof rawTx.URI === "string" &&
      rawTx.URI.length > 0 &&
      meta?.nftoken_id
    ) {
      out.mintURIs.push({ nftokenId: meta.nftoken_id, uri: rawTx.URI });
    }

    /* ── E2. NFT offer + ownership state.
     * Five tx types:
     *   - NFTokenMint           → ownership row (new NFT)
     *   - NFTokenBurn           → ownership row with is_burned=1, plus
     *                             closed-offer rows for offers attached
     *                             to the burned NFT
     *   - NFTokenCreateOffer    → active-offer row(s)
     *   - NFTokenCancelOffer    → closed-offer rows (closed_reason=cancelled)
     *   - NFTokenAcceptOffer    → closed-offer row(s) + ownership transfer
     * Replaces the OffersTab Incoming view's per-NFT browser fan-out
     * with an indexed CH lookup.  See nft-state-extractor.ts. */
    if (isSuccess) {
      const nftEvents = extractNftStateEvents(rawTx);
      if (nftEvents.offers.length > 0) {
        out.chNftOfferRows.push(...nftEvents.offers);
      }
      if (nftEvents.staticMetadata.length > 0) {
        out.chNftStaticMetadataRows.push(...nftEvents.staticMetadata);
      }
      if (nftEvents.ownership.length > 0) {
        out.chNftOwnershipRows.push(...nftEvents.ownership);
      }

      // Trustline state — RippleState changes are scattered across many
      // tx types (TrustSet, Payment-with-IOU, AMM ops, AccountDelete);
      // the extractor walks meta.AffectedNodes uniformly so we don't
      // need to enumerate types here. See trustline-state-extractor.ts.
      const trustlineRows = extractTrustlineEvents(rawTx);
      if (trustlineRows.length > 0) {
        out.chTrustlineRows.push(...trustlineRows);
      }
    }

    /* ── F. Token trades. Sources:
     *   - OfferCreate that crossed book offers
     *   - Payment with cross-currency pathfinding (book and/or AMM)
     *   - OfferCreate that crossed an AMM (post-AMM amendment)
     * One tx can produce multiple fills (multi-leg paths, multi-pool swaps). */
    const fills = extractTokenTrades(rawTx);
    for (const fill of fills) {
      if (fill.isXrpPair && fill.xrpVolumeDrops != null) {
        const currency =
          fill.takerGetsCurrency === "XRP"
            ? fill.takerPaysCurrency
            : fill.takerGetsCurrency;
        const issuer =
          fill.takerGetsCurrency === "XRP"
            ? (fill.takerPaysIssuer ?? "")
            : (fill.takerGetsIssuer ?? "");

        out.newTokenPairs.add(`${currency}|${issuer}`);
      }
      out.tokenTradeCount++;
    }

    /* ── G. AMM pool mutations (queue, applied sequentially after walk) */
    if (rawTx.TransactionType === "AMMCreate") {
      const ammAccount = findCreatedAMMAccount(meta?.AffectedNodes ?? []);
      if (ammAccount) {
        const assets = parseAMMCreateAssets(rawTx);
        if (assets) {
          out.ammMutations.push({
            kind: "create",
            account: ammAccount,
            ...assets,
          });
        }
      }
    }
    if (rawTx.TransactionType === "AMMDelete") {
      const deletedAccount = findDeletedAMMAccount(meta?.AffectedNodes ?? []);
      if (deletedAccount) {
        out.ammMutations.push({ kind: "delete", account: deletedAccount });
      }
    }
    if (rawTx.TransactionType === "AMMVote") {
      const feeUpdate = findAMMVoteFeeUpdate(meta?.AffectedNodes ?? []);
      if (feeUpdate) {
        out.ammMutations.push({ kind: "vote", ...feeUpdate });
      }
    }

    /* ── H. Cost basis + disposal for tracked accounts */
    if (ctx.trackedAccountSet.size > 0) {
      const cbEvents = extractCostBasisEvents(
        rawTx,
        meta?.AffectedNodes ?? [],
        ctx.trackedAccountSet,
        xrpPriceUsd,
      );
      for (const evt of cbEvents) {
        const cbKey = `${evt.address}|${evt.currency}|${evt.issuer}`;
        const existing = out.costBasisMap.get(cbKey);
        if (existing) {
          existing.qtyIncrease = (
            parseFloat(existing.qtyIncrease) + parseFloat(evt.qtyIncrease)
          ).toString();
          existing.costDrops += evt.costDrops;
          existing.costUsd = (
            parseFloat(existing.costUsd) + parseFloat(evt.costUsd)
          ).toFixed(8);
        } else {
          out.costBasisMap.set(cbKey, { ...evt });
        }
        out.costBasisEventCount++;
      }

      const dEvents = extractDisposalEvents(
        rawTx,
        meta?.AffectedNodes ?? [],
        ctx.trackedAccountSet,
        xrpPriceUsd,
        ledger.ledger_index,
        txDateIso,
      );
      out.disposalEvents.push(...dEvents);

      // XRP cost basis from DEX trades (Offer-node approach).
      const xrpCbEvents = extractXrpCostBasisEvents(
        rawTx,
        meta?.AffectedNodes ?? [],
        ctx.trackedAccountSet,
        xrpPriceUsd,
      );
      for (const evt of xrpCbEvents) {
        const cbKey = `${evt.address}|${evt.currency}|${evt.issuer}`;
        const existing = out.costBasisMap.get(cbKey);
        if (existing) {
          existing.qtyIncrease = (
            parseFloat(existing.qtyIncrease) + parseFloat(evt.qtyIncrease)
          ).toString();
          existing.costDrops += evt.costDrops;
          existing.costUsd = (
            parseFloat(existing.costUsd) + parseFloat(evt.costUsd)
          ).toFixed(8);
        } else {
          out.costBasisMap.set(cbKey, { ...evt });
        }
        out.costBasisEventCount++;
      }

      const xrpDEvents = extractXrpDisposalEvents(
        rawTx,
        meta?.AffectedNodes ?? [],
        ctx.trackedAccountSet,
        xrpPriceUsd,
        ledger.ledger_index,
        txDateIso,
      );
      out.disposalEvents.push(...xrpDEvents);
    }

    /* ── I. account_tx_index — AffectedNodes-only per-account rows.
     * Captures offer crossings, AMM LP changes, trustline peer side
     * effects, AccountRoot indirect mods. Sender/destination already
     * covered by `transactions` PK + `value_transfer_events`. Gated on
     * `writeAccountTxIndex` so backfill can opt out (default true). */
    if (ctx.writeAccountTxIndex !== false) {
      const accountIndexRows = extractAccountTxIndex(rawTx, {
        ledger_index: ledger.ledger_index,
        close_time: ledger.close_time,
      });
      if (accountIndexRows.length > 0) {
        out.chAccountTxIndexRows.push(...accountIndexRows);
      }
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/*  Writers                                                            */
/* ------------------------------------------------------------------ */

/** Probe ClickHouse to see if this ledger's transactions row already exists.
 *  Returns true → CH writes are no-ops; false → fresh ledger, write all rows. */
async function probeAlreadyWritten(ledgerIndex: number): Promise<boolean> {
  try {
    const rows = await ch.query<{ ledger_index: number }>(
      `SELECT DISTINCT ledger_index FROM transactions WHERE ledger_index = {idx:UInt32}`,
      { idx: ledgerIndex },
    );
    return rows.length > 0;
  } catch (err) {
    log.warn({ err, ledgerIndex }, "CH dedup probe failed — assuming fresh");
    return false;
  }
}

async function writeClickHouse(
  classified: ClassifiedLedger,
  walk: WalkResult,
): Promise<void> {
  const inserts: Promise<unknown>[] = [];

  if (classified.chRows.length > 0) {
    inserts.push(ch.insert("transactions", classified.chRows));
  }
  if (classified.chDexRows.length > 0) {
    inserts.push(ch.insert("dex_trades", classified.chDexRows));
  }
  if (classified.chTrustlineRows.length > 0) {
    inserts.push(
      ch.insert("trustline_events", classified.chTrustlineRows).catch((err) => {
        log.warn({ err, count: classified.chTrustlineRows.length }, "trustline_events insert failed");
      }),
    );
  }
  if (classified.chLedgerMetadata) {
    inserts.push(
      ch.insert("ledger_metadata", [classified.chLedgerMetadata]).catch((err) => {
        log.warn({ err }, "ledger_metadata insert failed");
      }),
    );
  }
  if (classified.chAmmStateChanges.length > 0) {
    inserts.push(
      ch.insert("amm_state_changes", classified.chAmmStateChanges).catch((err) => {
        log.warn({ err, count: classified.chAmmStateChanges.length }, "amm_state_changes insert failed");
      }),
    );
  }
  if (classified.chValueTransferEvents.length > 0) {
    inserts.push(
      ch.insert("value_transfer_events", classified.chValueTransferEvents).catch((err) => {
        log.warn({ err, count: classified.chValueTransferEvents.length }, "value_transfer_events insert failed");
      }),
    );
  }
  if (walk.chNftTradeRows.length > 0) {
    inserts.push(
      ch.insert("nft_trades", walk.chNftTradeRows).catch((err) => {
        log.warn({ err, count: walk.chNftTradeRows.length }, "nft_trades insert failed");
      }),
    );
  }
  if (walk.chNftOfferRows.length > 0) {
    inserts.push(
      ch.insert("nft_offers", walk.chNftOfferRows).catch((err) => {
        log.warn({ err, count: walk.chNftOfferRows.length }, "nft_offers insert failed");
      }),
    );
  }
  if (walk.chNftStaticMetadataRows.length > 0) {
    inserts.push(
      ch.insert("nft_static_metadata", walk.chNftStaticMetadataRows).catch((err) => {
        log.warn(
          { err, count: walk.chNftStaticMetadataRows.length },
          "nft_static_metadata insert failed",
        );
      }),
    );
  }
  if (walk.chNftOwnershipRows.length > 0) {
    inserts.push(
      ch.insert("nft_ownership", walk.chNftOwnershipRows).catch((err) => {
        log.warn({ err, count: walk.chNftOwnershipRows.length }, "nft_ownership insert failed");
      }),
    );
  }
  if (walk.chTrustlineRows.length > 0) {
    inserts.push(
      ch.insert("trustlines", walk.chTrustlineRows).catch((err) => {
        log.warn({ err, count: walk.chTrustlineRows.length }, "trustlines insert failed");
      }),
    );
  }
  if (walk.chPaymentCorridorRows.length > 0) {
    inserts.push(
      ch.insert("payment_corridors", walk.chPaymentCorridorRows).catch((err) => {
        log.warn({ err, count: walk.chPaymentCorridorRows.length }, "payment_corridors insert failed");
      }),
    );
  }
  if (walk.chAccountTxIndexRows.length > 0) {
    inserts.push(
      ch.insert("account_tx_index", walk.chAccountTxIndexRows).catch((err) => {
        log.warn({ err, count: walk.chAccountTxIndexRows.length }, "account_tx_index insert failed");
      }),
    );
  }

  if (inserts.length > 0) await Promise.all(inserts);
}

/** Apply all PG writes for a single ledger. Each table-level upsert is wrapped
 *  in its own try/catch to match existing per-store-atomic semantics — one
 *  failed table doesn't block the others. The `ctx` flag toggles let backfill
 *  skip current-state-only writes (amm_pools, token_metadata, etc.). */
async function writePostgres(
  ledger: ExpandedLedger["ledger"],
  classified: ClassifiedLedger,
  walk: WalkResult,
  alreadyWritten: boolean,
  ctx: IngestContext,
): Promise<void> {
  /* ── AMM pool mutations (sequential, dependency-ordered) ── */
  if (ctx.writeAmmPools !== false) {
    for (const m of walk.ammMutations) {
      try {
        if (m.kind === "create") {
          await db.insert(ammPools)
            .values({
              account: m.account,
              asset1Currency: m.asset1Currency,
              asset1Issuer: m.asset1Issuer,
              asset2Currency: m.asset2Currency,
              asset2Issuer: m.asset2Issuer,
              tradingFee: m.tradingFee,
            })
            .onConflictDoNothing();
        } else if (m.kind === "delete") {
          await db.delete(ammPools)
            .where(sql`${ammPools.account} = ${m.account}`);
        } else if (m.kind === "vote") {
          await db.update(ammPools)
            .set({ tradingFee: m.tradingFee })
            .where(sql`${ammPools.account} = ${m.account}`);
        }
      } catch (err) {
        log.warn({ err, kind: m.kind, account: m.account }, "amm pool mutation failed");
      }
    }
  }

  /* ── Token metadata auto-register ── */
  if (ctx.writeTokenMetadata !== false) {
    for (const pair of walk.newTokenPairs) {
      try {
        const [currency, issuer] = pair.split("|");
        await db.insert(tokenMetadata)
          .values({ currency, issuer })
          .onConflictDoNothing();
      } catch (err) {
        log.warn({ err, pair }, "token metadata auto-register failed");
      }
    }
  }

  // PG `fee_burn_hourly` writer was here pre-2026-05-09. CH MV `mv_fee_burn_hourly` is the source now.
  // PG `tx_count_hourly` writer was here pre-2026-05-09. CH MV `mv_tx_count_hourly` is the source now.
  // PG `payment_corridor_hourly` writer was here pre-2026-05-09. CH MV `mv_payment_corridor_hourly` is the source now.
  // PG `nft_volume_hourly` writer was here pre-2026-05-09. CH MV `mv_nft_volume_hourly` is the source now.
  // PG `token_volume_hourly` writer was here pre-2026-05-09. CH MV `mv_token_volume_hourly` is the source now.
  // PG `wallet_trade_volume_hourly` writer was here pre-2026-05-09. CH MV `mv_wallet_trade_volume_hourly` is the source now.

  /* ── Cost basis + realized PnL ── */
  for (const [, data] of walk.costBasisMap) {
    try {
      await db.insert(tokenCostBasis)
        .values({
          address: data.address,
          currency: data.currency,
          issuer: data.issuer,
          totalQtyAcquired: data.qtyIncrease,
          totalCostDrops: data.costDrops.toString(),
          totalCostUsd: data.costUsd,
        })
        .onConflictDoUpdate({
          target: [tokenCostBasis.address, tokenCostBasis.currency, tokenCostBasis.issuer],
          set: {
            totalQtyAcquired: sql`${tokenCostBasis.totalQtyAcquired}::numeric + ${data.qtyIncrease}::numeric`,
            totalCostDrops: sql`${tokenCostBasis.totalCostDrops}::numeric + ${BigInt(data.costDrops)}`,
            totalCostUsd: sql`${tokenCostBasis.totalCostUsd}::numeric + ${data.costUsd}::numeric`,
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      log.warn({ err, address: data.address }, "token_cost_basis upsert failed");
    }
  }

  for (const d of walk.disposalEvents) {
    try {
      // Look up current WAVG cost from DB to compute realized PnL.
      const costRows = await db
        .select({
          totalQtyAcquired: tokenCostBasis.totalQtyAcquired,
          totalCostUsd: tokenCostBasis.totalCostUsd,
          totalCostDrops: tokenCostBasis.totalCostDrops,
        })
        .from(tokenCostBasis)
        .where(
          sql`${tokenCostBasis.address} = ${d.address}
            AND ${tokenCostBasis.currency} = ${d.currency}
            AND ${tokenCostBasis.issuer} = ${d.issuer}`,
        )
        .limit(1);

      const costRow = costRows[0];
      const qty = parseFloat(d.qtySold);
      let costBasisUsd = 0;
      let costBasisDrops = 0n;

      if (costRow) {
        const totalQty = parseFloat(costRow.totalQtyAcquired ?? "0");
        const totalCost = parseFloat(costRow.totalCostUsd ?? "0");
        let totalDrops = 0n;
        try { totalDrops = BigInt(costRow.totalCostDrops ?? "0"); } catch { /* non-integer */ }

        if (totalQty > 0) {
          const avgCostUsd = totalCost / totalQty;
          costBasisUsd = qty * avgCostUsd;
          // Number for the division to avoid BigInt truncation compounding.
          const avgCostDropsPerUnit = Number(totalDrops) / totalQty;
          costBasisDrops = BigInt(Math.round(qty * avgCostDropsPerUnit));
        }
      }

      const proceedsUsd = parseFloat(d.proceedsUsd);
      const pnlUsd = proceedsUsd - costBasisUsd;

      await db.insert(tokenRealizedPnl).values({
        address: d.address,
        currency: d.currency,
        issuer: d.issuer,
        qtySold: d.qtySold,
        costBasisUsd: costBasisUsd.toFixed(8),
        proceedsUsd: d.proceedsUsd,
        pnlUsd: pnlUsd.toFixed(8),
        txHash: d.txHash,
        ledgerIndex: d.ledgerIndex,
        realizedAt: d.timestamp,
      }).onConflictDoNothing();

      // Reduce cost basis running totals.
      if (costRow) {
        await db.update(tokenCostBasis)
          .set({
            totalQtyAcquired: sql`GREATEST(${tokenCostBasis.totalQtyAcquired}::numeric - ${d.qtySold}::numeric, 0)`,
            totalCostDrops: sql`GREATEST(${tokenCostBasis.totalCostDrops}::numeric - ${costBasisDrops.toString()}::numeric, 0)`,
            totalCostUsd: sql`GREATEST(${tokenCostBasis.totalCostUsd}::numeric - ${costBasisUsd.toFixed(8)}::numeric, 0)`,
            updatedAt: new Date(),
          })
          .where(
            sql`${tokenCostBasis.address} = ${d.address}
              AND ${tokenCostBasis.currency} = ${d.currency}
              AND ${tokenCostBasis.issuer} = ${d.issuer}`,
          );
      }
    } catch (err) {
      log.warn({ err, address: d.address, txHash: d.txHash }, "realized PnL write failed");
    }
  }

  /* ── Account counter deltas — gated on alreadyWritten so retries don't
   * double-count. Mirrors the per-batch logic in intel-ingestion's
   * upsertCounterDeltas (see ~line 1085).
   *
   * Tier 1.5.2 (2026-04-28): rows sorted by address before the upsert.
   * Without this, the live ingester and backfill could request locks on
   * the same set of accounts in different orders inside their respective
   * upsert transactions, and Postgres detects a deadlock and aborts one.
   * Sorting both writers by `address` ensures they always acquire row
   * locks in the same order — eliminates the deadlock window entirely.
   * Caught during the AMM-era re-ingestion: ~4 deadlocks/hour with a
   * 0.03% drop rate on counter updates (warned + skipped). See
   * docs/wiki/architecture/tier1.5-audit-findings.md Tier 1.5.2 entry. */
  // PG account_tx_counts upsert was here pre-2026-05-09. The counter
  // is now an AggregatingMergeTree in CH, populated by two MVs from
  // `transactions` and `value_transfer_events`. Live counts auto-update
  // via those MVs without needing an explicit write. See
  // `docs/plans/pg-to-ch-migration-2026-05-09.md` Phase 2.

  // PG `recent_nft_trades` rolling buffer was here pre-2026-05-09. CH
  // `nft_trades` (the source) is the only consumer now — the homepage
  // recent-trades feed reads from there directly via
  // `getRecentNftTrades` in `lib/db-queries.ts`. PG table dropped in
  // Phase 5 of the PG → CH migration.

  /* ── ingested_ledgers + ingestion_state pointers (atomicity gate — last) ── */
  if (ctx.writeIngestedLedgers !== false) {
    try {
      await db.insert(ingestedLedgers)
        .values({ ledgerIndex: ledger.ledger_index })
        .onConflictDoNothing();
    } catch (err) {
      log.warn({ err, ledgerIndex: ledger.ledger_index }, "ingested_ledgers upsert failed");
    }
  }

  const ledgerStr = ledger.ledger_index.toString();

  try {
    await db.insert(ingestionState)
      .values({ key: "latest_ledger", value: ledgerStr })
      .onConflictDoUpdate({
        target: ingestionState.key,
        set: {
          value: sql`GREATEST(${ingestionState.value}::int, ${ledger.ledger_index})::text`,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    log.warn({ err }, "latest_ledger pointer write failed");
  }

  try {
    await db.insert(ingestionState)
      .values({ key: "earliest_ledger", value: ledgerStr })
      .onConflictDoUpdate({
        target: ingestionState.key,
        set: {
          value: sql`CASE WHEN ${ingestionState.value} = '0' THEN ${ledgerStr} ELSE LEAST(${ingestionState.value}::int, ${ledger.ledger_index})::text END`,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    log.warn({ err }, "earliest_ledger pointer write failed");
  }

  // Intel pointer — last write. Anything before this can be replayed
  // safely on next run; this one signals "ledger fully done".
  try {
    await db.insert(ingestionState)
      .values({ key: "intel_latest_ledger", value: ledgerStr })
      .onConflictDoUpdate({
        target: ingestionState.key,
        set: {
          value: sql`GREATEST(${ingestionState.value}::int, ${ledger.ledger_index})::text`,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    log.warn({ err }, "intel_latest_ledger pointer write failed");
  }
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                 */
/* ------------------------------------------------------------------ */

/**
 * Ingest a single ledger end-to-end. Idempotent — safe to retry.
 *
 * Throws if the ledger fetch fails. Per-store write failures are logged but
 * don't stop the rest of the pipeline (matches existing per-store-atomic
 * behavior). The PG pointer advance is the very last write.
 */
export async function ingestLedger(
  ctx: IngestContext,
  ledgerIndex: number,
): Promise<void> {
  const t0 = Date.now();

  /* ── 1. Fetch ── */
  const result = (await ctx.xrpl.getLedger(ledgerIndex, true)) as ExpandedLedger;
  const ledger = result.ledger;
  if (ledger.close_time == null || ledger.ledger_index == null) {
    log.warn({ ledgerIndex }, "Ledger missing close_time / ledger_index — skipping");
    return;
  }

  /* ── 2. Classify (intel rows + account counters) ── */
  const classified = classifyLedger(result);
  if (!classified) {
    log.warn({ ledgerIndex }, "classifyLedger returned null — skipping");
    return;
  }

  /* ── 3. Walk for PG aggregations + new CH tables ── */
  let xrpPriceUsd = 0;
  if (ctx.trackedAccountSet.size > 0) {
    try {
      const priceData = await getXrpPrice();
      xrpPriceUsd = priceData.price;
    } catch {
      // Non-fatal — cost basis USD will be 0 for this ledger.
    }
  }
  const walk = walkTransactions(ledger, ctx, xrpPriceUsd);

  /* ── 4. CH dedup probe ── */
  const writeCH = ctx.writeClickHouse !== false;
  const alreadyWritten = writeCH ? await probeAlreadyWritten(ledger.ledger_index) : false;

  /* ── 5. ClickHouse write ── */
  if (writeCH && !alreadyWritten) {
    await writeClickHouse(classified, walk).catch((err) => {
      log.error({ err, ledgerIndex }, "ClickHouse batch write failed");
    });
  }

  /* ── 6. Sequential PG upserts ── */
  await writePostgres(ledger, classified, walk, alreadyWritten, ctx);

  /* ── 7. Fire-and-forget post-commit ── */
  if (ctx.captureNftUris !== false && (walk.mintURIs.length > 0 || walk.tradeNftIds.length > 0)) {
    captureNFTUris(ctx.xrpl, walk.mintURIs, walk.tradeNftIds).catch((err) => {
      log.warn({ err, ledgerIndex }, "NFT URI capture failed");
    });
  }
  if (ctx.queueTokenIcons !== false && walk.newTokenPairs.size > 0) {
    for (const pair of walk.newTokenPairs) {
      const [currency, issuer] = pair.split("|");
      queueTokenIconResolve(currency, issuer);
    }
  }

  log.info(
    {
      ledgerIndex: ledger.ledger_index,
      txs: classified.txCount,
      nftTrades: walk.nftTradeCount,
      tokenTrades: walk.tokenTradeCount,
      corridors: walk.corridorCount,
      costBasis: walk.costBasisEventCount,
      chFresh: !alreadyWritten,
      ms: Date.now() - t0,
    },
    "Ledger ingested",
  );
}

/* ------------------------------------------------------------------ */
/*  Post-commit NFT URI capture                                        */
/* ------------------------------------------------------------------ */

/**
 * Populate the `nft_metadata` cache with URIs discovered during ingestion.
 * Mint URIs are written directly (URI is inline on the mint tx). Trade URIs
 * require an `nft_info` lookup since NFTokenAcceptOffer doesn't carry the
 * URI. Runs fire-and-forget — never blocks the ingestion loop.
 */
async function captureNFTUris(
  xrpl: XrplClient,
  mintURIs: Array<{ nftokenId: string; uri: string }>,
  tradeNftIds: string[],
): Promise<void> {
  await Promise.allSettled(
    mintURIs.map(({ nftokenId, uri }) => recordKnownURI(nftokenId, uri)),
  );

  const mintedIds = new Set(mintURIs.map((m) => m.nftokenId));
  const toLookup = [...new Set(tradeNftIds)].filter((id) => !mintedIds.has(id));

  await Promise.allSettled(
    toLookup.map(async (nftokenId) => {
      try {
        const info = await xrpl.getNFTInfo(nftokenId);
        if (info?.uri) await recordKnownURI(nftokenId, info.uri);
      } catch {
        // nft_info may fail on non-Clio nodes; skip silently.
      }
    }),
  );
}
