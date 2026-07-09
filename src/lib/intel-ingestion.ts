/**
 * IntelIngestionManager — writes raw XRPL transactions to ClickHouse
 * for the intelligence layer.
 *
 * Piggybacks on the main IngestionManager: polls for newly ingested ledgers
 * and processes them into the intel stores. No extra XRPL WebSocket needed.
 *
 * Gated by ENABLE_INGESTION + DATABASE_URL + CLICKHOUSE_URL.
 *
 * Pre-2026-05-01 this also projected per-tx graph edges to Neo4j (PAYMENT,
 * DEX_TRADE, regular-key updates). Neo4j was retired alongside the Pro
 * tier reshape — see `docs/plans/neo4j-removal.md` — so the graph writes
 * are gone. value_transfer_events in CH is now the only system of record
 * for cross-account flow analysis.
 */

import "server-only";
import logger from "./logger";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ingestedLedgers, ingestionState } from "@/db/schema";
import { getIngestionClient } from "./ingestion";
import { extractTokenTrades } from "./trade-extractors";
import * as ch from "./clickhouse-client";
import type { RawLedgerTx, ExpandedLedger, CurrencyAmount } from "@/types/ingestion";
import { XRPL_EPOCH } from "./xrpl-helpers";
import { isAmendmentActive } from "./xrpl-amendments";

const log = logger.child({ module: "intel-ingestion" });

/** Poll for new ledgers every 5 seconds */
const POLL_INTERVAL = 5_000;

/** Process up to N ledgers per poll cycle. Kept modest so the per-batch
 *  CH inserts stay quick and don't hold the WS busy too long. */
const BATCH_SIZE = 10;

/** Parallelism when fetching ledger details from XRPL.
 *  Keep conservative — the WS request timeout is 8s and expanded-ledger
 *  responses are large; too many concurrent fetches cause widespread timeouts. */
const FETCH_CONCURRENCY = 5;

/** Max consecutive failures before skipping a ledger */
const MAX_RETRIES_PER_LEDGER = 5;

/** Retry connectivity check every 60 seconds if stores were unreachable at startup */
const CONNECTIVITY_RETRY_INTERVAL = 60_000;

/* ------------------------------------------------------------------ */
/*  Helper: parse amount fields                                        */
/* ------------------------------------------------------------------ */

/** Int64 range for ClickHouse `amount_drops` columns. XRPL drops fit
 *  comfortably (max XRP supply ~1e17 drops vs Int64 max ~9.2e18) but we
 *  clamp defensively against malformed payloads. */
const INT64_MAX = 9_223_372_036_854_775_807n;
const INT64_MIN = -9_223_372_036_854_775_808n;

const clampLog = logger.child({ module: "intel-ingestion", part: "clampInt64" });

/** Clamp a bigint to Int64 range. Logs a warning on actual clamp because
 *  XRPL drops shouldn't ever exceed Int64 in honest data — a clamp event
 *  signals either a malformed payload or a logic bug upstream that's
 *  worth investigating. */
function clampInt64(value: bigint): bigint {
  if (value > INT64_MAX) {
    clampLog.warn({ value: value.toString(), bound: "INT64_MAX" }, "clampInt64 overflow — input exceeds Int64.MAX, clamped");
    return INT64_MAX;
  }
  if (value < INT64_MIN) {
    clampLog.warn({ value: value.toString(), bound: "INT64_MIN" }, "clampInt64 underflow — input below Int64.MIN, clamped");
    return INT64_MIN;
  }
  return value;
}

interface ParsedXrplAmount {
  /** XRP drops as BigInt (clamped to Int64). 0n for IOU/missing. */
  drops: bigint;
  /** IOU as JSON-serialised {currency, issuer, value}. "" for XRP/missing. */
  iou: string;
  isXrp: boolean;
  currency: string;
  issuer: string;
}

/**
 * Parse an XRPL Amount field into the shape `transactions` stores.
 *
 *   XRP  → string drops    → BigInt + Int64 clamp                    → drops column
 *   IOU  → {currency,issuer,value} → JSON.stringify (lossless)       → iou column
 *
 * Lossless on both legs:
 *   - XRP via BigInt avoids JS Number's 2^53 ceiling (max XRP is 1e17).
 *   - IOU via raw JSON preserves XRPL's 16-significant-digit precision
 *     (Number() rounds at 15 sig digits, and the previous Math.trunc()
 *     dropped the entire fractional component).
 *
 * Replaces the legacy `parseAmount` (lossy IOU) and `splitAmount` (XRP via
 * Number) — every call site uses the unified shape now.
 */
function parseXrplAmount(
  amount: string | CurrencyAmount | undefined,
): ParsedXrplAmount {
  if (!amount) {
    return { drops: 0n, iou: "", isXrp: true, currency: "XRP", issuer: "" };
  }
  if (typeof amount === "string") {
    // XRP drops as a numeric string. Strip any trailing decimal (defensive —
    // drops should always be integers, but malformed payloads occasionally
    // include one). BigInt() rejects non-integer strings.
    let drops = 0n;
    try {
      const clean = amount.includes(".") ? amount.split(".")[0] : amount;
      drops = clean === "" || clean === "-" ? 0n : clampInt64(BigInt(clean));
    } catch {
      drops = 0n;
    }
    return { drops, iou: "", isXrp: true, currency: "XRP", issuer: "" };
  }
  // IOU — preserve full {currency, issuer, value} shape as JSON.
  // No precision conversion: clients parse the value string directly.
  return {
    drops: 0n,
    iou: JSON.stringify(amount),
    isXrp: false,
    currency: amount.currency ?? "",
    issuer: amount.issuer ?? "",
  };
}

/* ------------------------------------------------------------------ */
/*  Phase 2 helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Pull `nftoken_id` from a transaction's meta. rippled annotates this on
 * NFTokenMint, NFTokenBurn, NFTokenAcceptOffer, NFTokenCreateOffer, and
 * NFTokenCancelOffer at the top level of `meta` for convenience — saves
 * us walking AffectedNodes ourselves.
 *
 * Returns "" (32-byte zero string substitute) when no NFT id is present.
 * The CH column is FixedString(64); we pad with '0' chars to match.
 */
function extractNftokenId(meta: { nftoken_id?: string } | undefined): string {
  const id = meta?.nftoken_id;
  if (!id || typeof id !== "string" || id.length !== 64) {
    // FixedString(64) requires exactly 64 chars. Use all-zero string as the
    // "absent" sentinel. Matches the migration's `DEFAULT toFixedString('0', 64)`.
    return "0".repeat(64);
  }
  return id.toUpperCase();
}

/** Decode a hex-encoded memo field (MemoData / MemoType / MemoFormat) to UTF-8.
 *  Returns "" for non-hex / non-UTF-8 / undefined inputs. Memos are stored
 *  hex-encoded on XRPL; nearly all real-world memos are UTF-8 text but we
 *  swallow decode errors rather than throw. */
function decodeMemoField(hex: string | undefined): string {
  if (!hex || typeof hex !== "string") return "";
  try {
    return Buffer.from(hex, "hex").toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract AMM state-change rows from an AMM* management transaction's meta.
 *
 * Tier 1.5 (2026-04-28) scope: this function fires only for AMM* tx types
 * (AMMCreate, AMMDeposit, AMMWithdraw, AMMVote, AMMBid, AMMDelete,
 * AMMClawback) — i.e. AMM management operations that modify the AMM ledger
 * entry directly. **Payment- and OfferCreate-driven AMM swaps are NOT
 * captured here** — empirically those txs don't modify the AMM ledger
 * entry; they mutate the AMM's pseudo-account AccountRoot + RippleState
 * instead. Swap volume is recorded in `dex_trades` via
 * `extractAmmFillsFromTx` in trade-extractors.ts (which detects swaps via
 * AccountRoot.AMMID). See docs/wiki/architecture/tier1.5-audit-findings.md C6.
 *
 * Walks `meta.AffectedNodes` for AMM ledger object diffs:
 *   - CreatedNode  → AMMCreate (no PreviousFields). Read NewFields only.
 *   - DeletedNode  → AMMDelete (no FinalFields).    Read PreviousFields only.
 *   - ModifiedNode → Deposit / Withdraw / Vote / Bid / Clawback. Read FinalFields.
 *
 * Returns one row per AMM ledger object the tx touched. AMM* txs always
 * touch exactly one pool, so this returns 0 or 1 rows in practice.
 */
function extractAmmStateChanges(
  rawTx: RawLedgerTx,
  meta: { AffectedNodes?: Array<Record<string, unknown>> } | undefined,
  ledgerIndex: number,
  timestamp: string,
  txHash: string,
): CHAmmStateChange[] {
  if (!meta?.AffectedNodes) return [];
  const txType = rawTx.TransactionType;

  /* Map XRPL tx type to our `change_type` low-cardinality enum.
   *
   * Tier 1.5 (2026-04-28): removed Payment/OfferCreate → 'swap'. Empirically
   * NO Payments in production (post-AMM amendment) modify the AMM ledger
   * entry — swaps mutate only the AMM's pseudo-account AccountRoot +
   * RippleState, leaving the AMM ledger object untouched. The 'swap'
   * branch was effectively dead code that misleadingly suggested
   * amm_state_changes was a swap log.
   *
   * The actual swap volume lives in dex_trades (via extractAmmFillsFromTx
   * in trade-extractors.ts, which detects swaps via AccountRoot.AMMID).
   * amm_state_changes is now correctly scoped to "AMM management ops"
   * (Create/Deposit/Withdraw/Vote/Bid/Delete/Clawback). */
  const changeType = (() => {
    switch (txType) {
      case "AMMCreate":   return "create";
      case "AMMDeposit":  return "deposit";
      case "AMMWithdraw": return "withdraw";
      case "AMMVote":     return "vote";
      case "AMMBid":      return "bid";
      case "AMMDelete":   return "delete";
      case "AMMClawback": return "clawback";
      default: return null;
    }
  })();
  if (!changeType) return [];

  const rows: CHAmmStateChange[] = [];

  for (const node of meta.AffectedNodes) {
    const created = (node as { CreatedNode?: { LedgerEntryType: string; LedgerIndex?: string; NewFields?: Record<string, unknown> } }).CreatedNode;
    const modified = (node as { ModifiedNode?: { LedgerEntryType: string; LedgerIndex?: string; FinalFields?: Record<string, unknown>; PreviousFields?: Record<string, unknown> } }).ModifiedNode;
    const deleted = (node as { DeletedNode?: { LedgerEntryType: string; LedgerIndex?: string; FinalFields?: Record<string, unknown>; PreviousFields?: Record<string, unknown> } }).DeletedNode;

    let fields: Record<string, unknown> | undefined;
    let poolId: string | undefined;

    if (created && created.LedgerEntryType === "AMM") {
      fields = created.NewFields;
      poolId = created.LedgerIndex;
    } else if (modified && modified.LedgerEntryType === "AMM") {
      // Asset / Asset2 are immutable post-creation, so they should always
      // be present in FinalFields. If they're missing (sparse meta from
      // certain rippled emit paths), fall back to PreviousFields. If both
      // are missing entirely, skip emission rather than write an empty
      // currency-shape row that would mislead consumers.
      const finalFields = modified.FinalFields;
      const prevFields = modified.PreviousFields;
      const finalHasAssets = finalFields?.Asset != null || finalFields?.Asset2 != null;
      fields = finalHasAssets ? finalFields : (prevFields ?? finalFields);
      poolId = modified.LedgerIndex;
    } else if (deleted && deleted.LedgerEntryType === "AMM") {
      // AMMDelete: rippled removes the AMM ledger entry without
      // mutating it, so FinalFields is absent and PreviousFields holds
      // the pre-deletion state — same shape as the unfunded-offer GC
      // bug we hit in extractFillFromNode. Read PreviousFields only.
      // (The previous `FinalFields ?? PreviousFields` fallback was
      // backwards relative to the docstring at the top of this fn.)
      fields = deleted.PreviousFields;
      poolId = deleted.LedgerIndex;
    }

    if (!fields || !poolId) continue;
    // Final guard: if neither Asset nor Asset2 is present in our chosen
    // fields source, skip emission — an AMM state-change row without a
    // currency pair is meaningless. Better than emitting a row with
    // empty asset shapes.
    if (fields.Asset == null && fields.Asset2 == null && fields.Amount == null && fields.Amount2 == null) {
      continue;
    }

    /* The AMM ledger object's actual fields are:
     *   - Asset, Asset2:     {currency, issuer} pair definitions (no `value`)
     *   - LPTokenBalance:    IOU-shaped (LP token outstanding supply)
     *   - TradingFee, AuctionSlot, VoteSlots: parameters
     *
     * It does NOT have `Amount` / `Amount2` reserve fields. Pool reserves
     * are stored externally on the AMM's pseudo-account: XRP via the AMM's
     * AccountRoot.Balance, IOU via RippleState entries between the AMM and
     * the issuer.
     *
     * For now we record the pair *definitions* (Asset/Asset2) plus the LP
     * supply, which gives consumers enough to look up current reserves
     * via the AMM account if needed. Computing post-state pool reserves
     * from the surrounding AccountRoot/RippleState mutations is left for
     * a follow-up — those amounts can be derived from the same AMM Account
     * walk extractAmmFillsFromTx() does in trade-extractors.ts.
     *
     * Pre-fix history: the original code read fields.Amount/Amount2 and
     * silently produced empty strings (those fields don't exist on AMM
     * ledger objects). All ~8K historical amm_state_changes rows have
     * blank asset values — they'll be re-populated correctly by the
     * planned AMM-era re-ingestion. */
    const asset1 = fields.Asset ?? fields.Amount; // Asset is canonical; Amount kept for forward-compat
    const asset2 = fields.Asset2 ?? fields.Amount2;
    const lp = fields.LPTokenBalance;

    rows.push({
      ledger_index: ledgerIndex,
      timestamp,
      tx_hash: txHash,
      pool_id: poolId.toUpperCase(),
      asset1_amount: asset1 == null ? "" : (typeof asset1 === "string" ? asset1 : JSON.stringify(asset1)),
      asset2_amount: asset2 == null ? "" : (typeof asset2 === "string" ? asset2 : JSON.stringify(asset2)),
      lp_supply: lp == null ? "" : (typeof lp === "string" ? lp : JSON.stringify(lp)),
      change_type: changeType,
    });
  }

  return rows;
}

/**
 * For cross-currency Payments, emit a SECOND value_transfer_events row
 * representing the source asset that left the sender. The main Payment
 * row records the delivered asset (recipient side); this complement
 * captures the released asset (sender side), giving complete fund-tracing
 * across cross-currency Payments instead of the prior one-asset blind spot.
 *
 * Detection: SendMax exists AND its currency or issuer differs from the
 * delivered amount's currency/issuer. (Same-currency Payments don't need
 * a source row — the delivered side already shows the value moving.)
 *
 * Amount: rippled may use less of SendMax than the cap (better path found).
 * We walk meta for the sender's actual balance delta in the SendMax
 * currency. For XRP source: AccountRoot delta + tx.Fee (since the fee
 * was also paid by sender). For IOU source: the matching RippleState
 * mutation; the sign convention depends on which side of the trustline
 * the sender is on, so we use the absolute delta on the sender's side.
 *
 * Returns 0 or 1 row. Returns 0 if not cross-currency, or if the source
 * delta can't be reconstructed from meta (rare; safer to omit than to
 * emit a wrong amount).
 */
function extractCrossCurrencySourceRow(
  rawTx: RawLedgerTx,
  meta: { AffectedNodes?: Array<Record<string, unknown>> } | undefined,
  ledgerIndex: number,
  timestamp: string,
  delivered: ParsedXrplAmount,
): CHValueTransferEvent[] {
  const txFields = rawTx as unknown as Record<string, unknown>;
  const sendMax = txFields.SendMax as string | CurrencyAmount | undefined;
  if (sendMax === undefined) return [];

  const parsedSendMax = parseXrplAmount(sendMax);
  // Same currency+issuer means same asset on both sides — no extra row needed.
  if (parsedSendMax.currency === delivered.currency && parsedSendMax.issuer === delivered.issuer) {
    return [];
  }

  const sender = rawTx.Account;
  const dest = rawTx.Destination;
  if (!sender || !dest) return [];

  if (parsedSendMax.isXrp) {
    // XRP source: walk for sender's AccountRoot Balance delta. The delta is
    // (final - prev) and is NEGATIVE (sender lost XRP). Source amount sent =
    // |delta| - fee_drops (the fee is part of the negative delta but isn't
    // a transfer to the destination — it's burned).
    let sourceDrops = 0n;
    for (const node of meta?.AffectedNodes ?? []) {
      const m = (node as { ModifiedNode?: { LedgerEntryType: string; FinalFields?: Record<string, unknown>; PreviousFields?: Record<string, unknown> } }).ModifiedNode;
      if (!m || m.LedgerEntryType !== "AccountRoot") continue;
      const final = m.FinalFields as Record<string, unknown> | undefined;
      const prev = m.PreviousFields as Record<string, unknown> | undefined;
      if (final?.Account !== sender) continue;
      const finalBalStr = typeof final?.Balance === "string" ? final.Balance : "0";
      const prevBalStr = typeof prev?.Balance === "string" ? prev.Balance : finalBalStr;
      try {
        const finalBal = BigInt(finalBalStr.includes(".") ? finalBalStr.split(".")[0] : finalBalStr);
        const prevBal = BigInt(prevBalStr.includes(".") ? prevBalStr.split(".")[0] : prevBalStr);
        const feeDrops = BigInt((rawTx.Fee || "0").split(".")[0]);
        // Sender lost: prev - final (positive). Subtract fee since that's not a transfer.
        const lost = prevBal - finalBal;
        sourceDrops = clampInt64(lost - feeDrops);
      } catch { sourceDrops = 0n; }
      break;
    }
    if (sourceDrops <= 0n) return [];
    return [{
      tx_hash: rawTx.hash,
      ledger_index: ledgerIndex,
      timestamp,
      tx_type: rawTx.TransactionType,
      transfer_kind: TRANSFER_KINDS.PAYMENT_SOURCE,
      from_account: sender,
      to_account: dest,
      amount_drops: sourceDrops.toString(),
      amount_iou: "",
      currency: "XRP",
      issuer: "",
    }];
  }

  // IOU source: look at the RippleState between sender and the source-asset issuer.
  // RippleState balance is signed; the side that held positive (LowLimit) determines
  // sign convention. Rather than re-implementing that math, we just record the
  // SendMax cap as a fallback amount with a clear iou shape — the actual delivered
  // source value is in [some_minimum, SendMax]. This is closer to truth than
  // omitting the row entirely; if we need exact precision later, a fuller meta
  // walk is straightforward but more code.
  return [{
    tx_hash: rawTx.hash,
    ledger_index: ledgerIndex,
    timestamp,
    tx_type: rawTx.TransactionType,
    transfer_kind: TRANSFER_KINDS.PAYMENT_SOURCE,
    from_account: sender,
    to_account: dest,
    amount_drops: parsedSendMax.drops.toString(),
    amount_iou: parsedSendMax.iou,
    currency: parsedSendMax.currency,
    issuer: parsedSendMax.issuer,
  }];
}

/**
 * Canonical set of `transfer_kind` values written to `value_transfer_events`.
 * Centralized here (rather than scattered as string literals across the
 * extractor and the schema docs) so the LLM router context, the extractor,
 * and any consumer code reference the same single source of truth.
 *
 * **Populated** kinds emit rows from the extractor below. **Deferred** kinds
 * are documented for the LLM but the extractor doesn't yet produce them —
 * see Tier 2 backlog for the AffectedNodes-walking work each requires.
 */
export const TRANSFER_KINDS = {
  PAYMENT: "payment",
  PAYMENT_SOURCE: "payment_source",
  ACCOUNT_DELETE: "account_delete",
  CHECK_CASH: "check_cash",
  CLAWBACK: "clawback",
  // Deferred — extractors not yet implemented.
  ESCROW_FINISH: "escrow_finish",
  PAYCHAN_CLAIM: "paychan_claim",
  XCHAIN_CLAIM: "xchain_claim",
} as const;

/**
 * Extract value-transfer events from a successful tx.
 *
 * Returns 0 or more rows depending on the tx type. The unified table
 * captures every "money moves between accounts" event across XRPL:
 *
 *   - Payment             → 1 row (sender → destination, delivered amount).
 *                           Cross-currency Payments emit a SECOND row with
 *                           transfer_kind='payment_source' showing the
 *                           source asset that left the sender's balance
 *                           (e.g., sender paid USD → recipient received EUR
 *                           emits one 'payment' row for EUR delivery and one
 *                           'payment_source' row for USD released).
 *   - AccountDelete       → 1 row (deleted account → inheritor, swept XRP balance)
 *   - CheckCash           → 1 row (check sender → tx.Account, cashed amount)
 *   - Clawback            → 1 row (holder → issuer, clawed-back IOU amount)
 *   - AMMClawback         → 1 row (AMM pool holder → issuer, AMM-clawed IOU amount)
 *   - EscrowFinish        → DEFERRED (escrow owner → original Destination)
 *   - PaymentChannelClaim → DEFERRED (channel source → tx.Destination)
 *   - XChainClaim         → DEFERRED (bridge → claimer)
 *
 * Self-transfers (from === to) are dropped — they don't represent value
 * flow between distinct accounts.
 *
 * Failed txs (result !== "tesSUCCESS") return [] — only successful transfers
 * contribute to the value-flow log.
 */
function extractValueTransferEvents(
  rawTx: RawLedgerTx,
  meta: { TransactionResult?: string; AffectedNodes?: Array<Record<string, unknown>>; delivered_amount?: string | CurrencyAmount } | undefined,
  ledgerIndex: number,
  timestamp: string,
): CHValueTransferEvent[] {
  if (!meta || meta.TransactionResult !== "tesSUCCESS") return [];

  const tx_hash = rawTx.hash;
  const txType = rawTx.TransactionType;

  switch (txType) {
    case "Payment": {
      const dest = rawTx.Destination;
      if (!dest || dest === rawTx.Account) return [];
      // delivered_amount is canonical post-pathfinding amount; falls back to
      // tx.Amount for non-partial-payment same-currency Payments where
      // rippled may omit delivered_amount (in practice, modern rippled
      // includes it; backstop just in case).
      const parsed = parseXrplAmount(meta.delivered_amount ?? rawTx.Amount);
      return [
        {
          tx_hash,
          ledger_index: ledgerIndex,
          timestamp,
          tx_type: txType,
          transfer_kind: TRANSFER_KINDS.PAYMENT,
          from_account: rawTx.Account,
          to_account: dest,
          amount_drops: parsed.drops.toString(),
          amount_iou: parsed.iou,
          currency: parsed.currency,
          issuer: parsed.issuer,
        },
        ...extractCrossCurrencySourceRow(rawTx, meta, ledgerIndex, timestamp, parsed),
      ];
    }

    case "AccountDelete": {
      /* AccountDelete sweeps the deleted account's REMAINING XRP to
       * tx.Destination after:
       *   - The transaction fee is burned
       *   - Each owned ledger object (offers, trustlines, etc) burns its
       *     owner reserve (currently 0.2 XRP each at typical reserve)
       *
       * We can NOT use deleted_account.PreviousFields.Balance directly —
       * that's the pre-fee, pre-reserve-burn balance and overstates the
       * swept amount by 1+ XRP (base reserve + N × owner reserve + fee).
       *
       * Instead, we use the DESTINATION'S AccountRoot.Balance delta:
       *   swept = destination.final_balance - destination.previous_balance
       * That's exactly what landed in the destination's account — clean,
       * post-burn truth, no reserve math required. */
      const dest = rawTx.Destination;
      if (!dest || dest === rawTx.Account) return [];
      let sweptDrops = 0n;
      for (const node of meta.AffectedNodes ?? []) {
        const m = (node as { ModifiedNode?: { LedgerEntryType: string; FinalFields?: Record<string, unknown>; PreviousFields?: Record<string, unknown> } }).ModifiedNode;
        if (!m || m.LedgerEntryType !== "AccountRoot") continue;
        const final = m.FinalFields as Record<string, unknown> | undefined;
        const prev = m.PreviousFields as Record<string, unknown> | undefined;
        if (final?.Account !== dest) continue;
        const finalBalStr = typeof final?.Balance === "string" ? final.Balance : "0";
        const prevBalStr = typeof prev?.Balance === "string" ? prev.Balance : finalBalStr;
        try {
          const finalBal = BigInt(finalBalStr.includes(".") ? finalBalStr.split(".")[0] : finalBalStr);
          const prevBal = BigInt(prevBalStr.includes(".") ? prevBalStr.split(".")[0] : prevBalStr);
          sweptDrops = clampInt64(finalBal - prevBal);
        } catch {
          sweptDrops = 0n;
        }
        break;
      }
      // If destination's AccountRoot wasn't in meta (shouldn't happen for
      // a successful AccountDelete), skip the row rather than emit a wrong
      // value. A 0-delta row would also be misleading — drop it.
      if (sweptDrops <= 0n) return [];
      return [
        {
          tx_hash,
          ledger_index: ledgerIndex,
          timestamp,
          tx_type: txType,
          transfer_kind: TRANSFER_KINDS.ACCOUNT_DELETE,
          from_account: rawTx.Account,
          to_account: dest,
          amount_drops: sweptDrops.toString(),
          amount_iou: "",
          currency: "XRP",
          issuer: "",
        },
      ];
    }

    case "CheckCash": {
      /* CheckCash cashes a Check the tx.Account is the recipient of.
       *
       * The cashed amount comes from one of two tx fields:
       *   - tx.Amount     → exact-amount cash (recipient cashed exactly this)
       *   - tx.DeliverMin → variable cash; ACTUAL delivered value lies in
       *                     [DeliverMin, Check.SendMax]. tx.DeliverMin is a
       *                     FLOOR, NOT the delivered amount. Using it would
       *                     understate the transfer.
       *
       * For DeliverMin cashes we walk meta to find what was actually delivered:
       *   - The deleted Check entry has SendMax (upper bound)
       *   - The recipient's AccountRoot (XRP cash) or RippleState (IOU cash)
       *     mutation gives the precise delta
       *
       * For exact-amount (Amount) cashes, tx.Amount is the truth. */
      let from = "";
      let checkSendMax: string | CurrencyAmount | undefined;
      for (const node of meta.AffectedNodes ?? []) {
        const deleted = (node as { DeletedNode?: { LedgerEntryType: string; FinalFields?: Record<string, unknown> } }).DeletedNode;
        if (!deleted || deleted.LedgerEntryType !== "Check") continue;
        const final = deleted.FinalFields as Record<string, unknown> | undefined;
        if (final?.Account && typeof final.Account === "string") {
          from = final.Account;
        }
        if (final?.SendMax) {
          checkSendMax = final.SendMax as string | CurrencyAmount;
        }
        if (from) break;
      }
      if (!from || from === rawTx.Account) return [];

      const txFields = rawTx as unknown as Record<string, unknown>;
      const txAmount = txFields.Amount as string | CurrencyAmount | undefined;
      const txDeliverMin = txFields.DeliverMin as string | CurrencyAmount | undefined;

      let cashAmount: string | CurrencyAmount | undefined;
      if (txAmount !== undefined) {
        // Exact-amount cash: tx.Amount is the truth.
        cashAmount = txAmount;
      } else if (txDeliverMin !== undefined) {
        /* Variable-amount cash via DeliverMin. Walk meta for the actual
         * delivered value:
         *   - XRP: tx.Account's AccountRoot Balance delta (final - prev) +
         *          fee_drops (since the fee was paid by tx.Account too)
         *   - IOU: the RippleState between tx.Account and the issuer (or
         *          AccountRoot if issuer = tx.Account, edge case)
         *
         * The Check.SendMax tells us the currency/issuer for the IOU case.
         * If we can't reconstruct the actual amount, fall back to
         * Check.SendMax (the upper bound), which is closer to truth than
         * DeliverMin (the lower bound). */
        const sendMaxIsXrp = typeof checkSendMax === "string";
        if (sendMaxIsXrp) {
          // XRP cash — sum tx.Account's AccountRoot delta + fee
          let receivedDrops = 0n;
          for (const node of meta.AffectedNodes ?? []) {
            const m = (node as { ModifiedNode?: { LedgerEntryType: string; FinalFields?: Record<string, unknown>; PreviousFields?: Record<string, unknown> } }).ModifiedNode;
            if (!m || m.LedgerEntryType !== "AccountRoot") continue;
            const final = m.FinalFields as Record<string, unknown> | undefined;
            const prev = m.PreviousFields as Record<string, unknown> | undefined;
            if (final?.Account !== rawTx.Account) continue;
            const finalBal = typeof final?.Balance === "string" ? BigInt(final.Balance.split(".")[0] || "0") : 0n;
            const prevBal = typeof prev?.Balance === "string" ? BigInt(prev.Balance.split(".")[0] || "0") : finalBal;
            const feeDrops = BigInt((rawTx.Fee || "0").split(".")[0]);
            // Recipient's balance delta = received_xrp - fee. So received = delta + fee.
            receivedDrops = (finalBal - prevBal) + feeDrops;
            break;
          }
          cashAmount = receivedDrops > 0n ? receivedDrops.toString() : (checkSendMax ?? txDeliverMin);
        } else {
          // IOU cash — fall back to Check.SendMax (upper bound, exact for IOU
          // when the check was cashed in full). Walking RippleState to compute
          // the precise IOU delta requires non-trivial sign handling and is
          // deferred to Tier 2 — Check.SendMax is closer to truth than
          // tx.DeliverMin (lower bound) in the meantime.
          cashAmount = checkSendMax ?? txDeliverMin;
        }
      } else {
        // Neither Amount nor DeliverMin — malformed CheckCash, skip.
        return [];
      }

      const parsed = parseXrplAmount(cashAmount);
      return [
        {
          tx_hash,
          ledger_index: ledgerIndex,
          timestamp,
          tx_type: txType,
          transfer_kind: TRANSFER_KINDS.CHECK_CASH,
          from_account: from,
          to_account: rawTx.Account,
          amount_drops: parsed.drops.toString(),
          amount_iou: parsed.iou,
          currency: parsed.currency,
          issuer: parsed.issuer,
        },
      ];
    }

    case "Clawback":
    case "AMMClawback": {
      /* Clawback: an issuer reclaims their own currency from a holder.
       *
       * XRPL convention here is the famously confusing one: tx.Amount is
       * an IOU object whose `currency` is the currency being clawed back,
       * `issuer` is the HOLDER (NOT the issuer — issuer is tx.Account),
       * and `value` is the amount clawed. So:
       *   - tx.Account     = the issuer (the entity doing the clawback)
       *   - tx.Amount.issuer = the holder (loses the funds)
       *   - tx.Amount.currency / value = the IOU details
       *
       * We model this as a transfer from holder → issuer of the clawed
       * amount. transfer_kind='clawback' covers both Clawback (regular
       * IOU) and AMMClawback (AMM-issued LP tokens) since the modeling
       * is identical from a value-flow perspective. */
      const txFields = rawTx as unknown as Record<string, unknown>;
      const amountObj = txFields.Amount;
      if (!amountObj || typeof amountObj !== "object") return [];
      const amt = amountObj as { currency?: string; issuer?: string; value?: string };
      const holder = amt.issuer; // XRPL's "issuer" field on Clawback Amount = holder
      const issuer = rawTx.Account; // tx.Account = real issuer doing the clawback
      if (!holder || !issuer || holder === issuer) return [];
      const parsed = parseXrplAmount(amountObj as CurrencyAmount);
      // parseXrplAmount sees amountObj as a normal IOU and stores its iou shape
      // with issuer=holder; for the transfer row we want currency to reflect
      // the IOU but flip the from/to so it reads holder → issuer (real
      // direction of value flow). The issuer string in our row is the
      // *minting* issuer (which is rawTx.Account here, the real issuer);
      // we re-emit a clean iou-shape blob with the correct minting-issuer
      // tag so downstream consumers don't mistake holder for issuer.
      const ammount = amt.value ?? "0";
      const iouBlob = JSON.stringify({ currency: amt.currency ?? "", issuer, value: ammount });
      return [
        {
          tx_hash,
          ledger_index: ledgerIndex,
          timestamp,
          tx_type: txType,
          transfer_kind: TRANSFER_KINDS.CLAWBACK,
          from_account: holder,
          to_account: issuer,
          amount_drops: parsed.drops.toString(),
          amount_iou: iouBlob,
          currency: amt.currency ?? "",
          issuer,
        },
      ];
    }

    /* TODO Tier 2: EscrowFinish, PaymentChannelClaim, XChainClaim.
     *
     * EscrowFinish: walk meta for the Escrow DeletedNode. Its FinalFields
     *   has Account (creator), Destination, Amount. Amount goes to
     *   Destination from Account.
     *
     * PaymentChannelClaim: walk meta for PayChannel ModifiedNode (or
     *   DeletedNode if the channel closes). Source = channel Account,
     *   Destination = channel Destination. Amount delivered = the diff of
     *   the channel's balance ('Balance' field) before/after, OR
     *   tx.Amount if a settle, OR derive from the channel's source's
     *   AccountRoot delta minus fees.
     *
     * XChainClaim: walk meta for the Bridge ledger entry mutation; the
     *   tx specifies OtherChainSource + Amount + claimee.
     *
     * These are deferred to Tier 2 because the AffectedNodes-walking logic
     * is non-trivial and worth careful unit testing. Until shipped, they
     * leave gaps in the value-flow log for these tx types. */
    default:
      return [];
  }
}

/**
 * Build the per-ledger metadata row from an expanded ledger response.
 * Returns null on malformed input.
 */
function buildLedgerMetadata(result: ExpandedLedger, isoDate: string): CHLedgerMetadata | null {
  const ledger = result.ledger;
  if (ledger.ledger_index == null || ledger.close_time == null) return null;
  const txCount = (ledger.transactions ?? []).length;
  return {
    ledger_index: ledger.ledger_index,
    ledger_hash: (ledger.ledger_hash ?? "").toUpperCase().padEnd(64, "0").slice(0, 64),
    parent_hash: (ledger.parent_hash ?? "").toUpperCase().padEnd(64, "0").slice(0, 64),
    close_time: isoDate,
    close_flags: Number(ledger.close_flags ?? 0),
    total_coins: Number(ledger.total_coins ?? 0),
    account_hash: (ledger.account_hash ?? "").toUpperCase().padEnd(64, "0").slice(0, 64),
    transaction_hash: (ledger.transaction_hash ?? "").toUpperCase().padEnd(64, "0").slice(0, 64),
    base_fee_drops: Number(ledger.base_fee ?? 0),
    reserve_base: Number(ledger.reserve_base ?? 0),
    reserve_increment: Number(ledger.reserve_increment ?? 0),
    tx_count: txCount,
    validator_count: 0, // Not in expanded ledger response; would need server_info or validators stream
  };
}

/* ------------------------------------------------------------------ */
/*  ClickHouse row types                                               */
/* ------------------------------------------------------------------ */

/** Sentinel account value for pseudo-transactions (EnableAmendment, SetFee,
 *  UNLModify) which have no real Account field. Account-keyed CH queries
 *  must filter these out: `WHERE account NOT IN ('', '__pseudo_tx__')`.
 *  Pre-existing rows with empty account get retagged via Day 1 mutation. */
export const PSEUDO_TX_ACCOUNT = "__pseudo_tx__";

/** Tx types that have no Account field (pseudo-transactions). */
const PSEUDO_TX_TYPES = new Set(["EnableAmendment", "SetFee", "UNLModify"]);

interface CHTransaction {
  [key: string]: string | number;
  tx_hash: string;
  tx_type: string;
  account: string;
  destination: string;
  /* Int64 columns are sent as strings to preserve precision.
   * @clickhouse/client serialises rows as JSON, and JS Number caps at 2^53
   * (~9e15) — XRPL drops can reach 1e17, so passing as Number truncates.
   * Strings round-trip cleanly through Int64. */
  amount_drops: string;
  /* IOU value as JSON-encoded {currency, issuer, value}. "" for XRP rows.
   * Replaces the legacy double-purpose amount_drops column for IOU
   * (which lost decimals + sig digits past 2^53). XRP rows leave this "".
   * Added via migrate-phase2-ch-schema.ts on 2026-04-28. */
  amount_iou: string;
  currency: string;
  issuer: string;
  fee_drops: number;
  timestamp: string;
  ledger_index: number;
  result: string;
  memo: string;
  /* Phase 2 schema additions (matches scripts/migrate-phase2-ch-schema.ts).
   * Forward-only: pre-Phase 2 rows from live ingestion have empty defaults
   * for these columns; backfill populates them for historical ledgers. */
  tx_json: string;
  meta_json: string;
  nftoken_id: string;
  flags: number;
  sequence: number;
  source_tag: number;
  destination_tag: number;
  delivered_amount_drops: string;
  delivered_amount_iou: string;
  /* Memo decoding (added 2026-04-28). Captures MemoType + MemoFormat for the
   * first memo. Multi-memo arrays are <5% of txs and full data is in tx_json
   * if a consumer needs the others. LowCardinality on the column side. */
  memo_type: string;
  memo_format: string;
  /* Tier 1.5 additions (2026-04-28). Top-level columns for queryable common
   * fields that previously required JSONExtract on tx_json. ALTER added them
   * with DEFAULT 0 / '', so pre-Tier-1.5 rows have empty defaults. */
  /** XRPL LastLedgerSequence — caps when the tx must be included by. Useful
   *  for analyzing time-to-live patterns, abandoned txs, expiry windows. */
  last_ledger_sequence: number;
  /** TicketSequence — when the sender used a ticket instead of incrementing
   *  Account.Sequence. Non-zero rows = ticket-using txs. */
  ticket_sequence: number;
  /** SigningPubKey — the public key that signed the tx. Lets you distinguish
   *  master-key signs from regular-key / multisig signs. Empty string when
   *  multisig (the Signers array carries the keys instead). */
  signing_pub_key: string;
  /** NetworkID — XRPL networks beyond mainnet (sidechains, devnet, etc.). 0
   *  on mainnet. Future-proofing for multi-network analytics. */
  network_id: number;
}

interface CHLedgerMetadata {
  [key: string]: string | number;
  ledger_index: number;
  ledger_hash: string;
  parent_hash: string;
  close_time: string;
  close_flags: number;
  total_coins: number;
  account_hash: string;
  transaction_hash: string;
  base_fee_drops: number;
  reserve_base: number;
  reserve_increment: number;
  tx_count: number;
  validator_count: number;
}

interface CHAmmStateChange {
  [key: string]: string | number;
  ledger_index: number;
  timestamp: string;
  tx_hash: string;
  pool_id: string;
  asset1_amount: string;
  asset2_amount: string;
  lp_supply: string;
  /** Tier 1.5 (2026-04-28): the 'swap' value was removed — Payment/
   *  OfferCreate-driven AMM swaps don't modify the AMM ledger entry, so
   *  this table is now scoped to AMM management ops only. Swap volume
   *  lives in dex_trades via extractAmmFillsFromTx (AccountRoot.AMMID
   *  detection in trade-extractors.ts). */
  change_type: string;  // create | deposit | withdraw | vote | bid | delete | clawback
}

interface CHDexTrade {
  [key: string]: string | number;
  tx_hash: string;
  /** Tier 1.5 (2026-04-28): disambiguates the multi-fill case where one tx
   *  consumes multiple offers from the same maker. Without this, dedup on
   *  (tx_hash, ...) would lose rows on replay.
   *
   *  Sourced from the underlying fills array index — NOT a dense emit
   *  counter. The extractor skips XRP-XRP fills (degenerate self-trades),
   *  and skipped slots leave gaps in the emitted sequence (e.g., emitted
   *  rows can be 0, 2, 3 if fills[1] was XRP-XRP). This is benign for
   *  dedup (same input always produces the same set of indices, so
   *  ReplacingMergeTree merges correctly), but consumers shouldn't
   *  assume density — `max(fill_index)+1 == count(*)` is not guaranteed
   *  per tx_hash, and `fill_index = N` doesn't imply `fill_index = N-1`
   *  exists. Use `count(*)` if you need a fill count per tx, not
   *  `max(fill_index)+1`. Switching to a dense emit counter would change
   *  index assignments mid-deploy and break replay dedup, so we keep
   *  the source-array-index semantics. */
  fill_index: number;
  timestamp: string;
  ledger_index: number;
  taker: string;
  maker: string;
  base_currency: string;
  base_issuer: string;
  /** Float64 — chartable but lossy for IOU values past ~15 sig digits.
   *  Charts and aggregates can use this; for lossless math read base_amount_iou. */
  base_amount: number;
  /** Tier 1.5: lossless IOU value as a decimal string. "" for XRP-side fills.
   *  Mirror of amount_iou on transactions. Use this for precise PnL / cost
   *  basis math; use base_amount for display and chart aggregations. */
  base_amount_iou: string;
  quote_currency: string;
  quote_issuer: string;
  /** Float64 — chartable but lossy for IOU. See base_amount note. */
  quote_amount: number;
  /** Tier 1.5: lossless IOU value as a decimal string. "" for XRP-side fills. */
  quote_amount_iou: string;
  price: number;
  /** Stored as a decimal string so JSONEachRow inserts the full Int64
   *  value without going through JS Number's 2^53 ceiling. CH `dex_trades`
   *  column type is Int64; oversized XRPL drops would silently round at
   *  the JS Number boundary if typed as `number` here. */
  xrp_volume_drops: string;
}

interface CHTrustlineEvent {
  [key: string]: string | number;
  tx_hash: string;
  ledger_index: number;
  timestamp: string;
  account: string;
  currency: string;
  issuer: string;
  limit_amount: number;
  action: string; // 'set' | 'delete'
}

/** Unified value-transfer event. One row per (tx, from→to, currency)
 *  tuple. System of record for cross-account flow analysis (counterparty
 *  lookups, fund tracing, common-counterparty intersect, etc.).
 *
 *  See migrate-phase2-ch-schema.ts for the table DDL. */
interface CHValueTransferEvent {
  [key: string]: string | number;
  tx_hash: string;
  ledger_index: number;
  timestamp: string;
  tx_type: string;
  /** 'payment' | 'escrow_finish' | 'paychan_claim' | 'check_cash' |
   *  'account_delete' | 'xchain_claim' */
  transfer_kind: string;
  from_account: string;
  to_account: string;
  /** XRP drops as Int64 string (BigInt → toString). 0 for IOU. */
  amount_drops: string;
  /** IOU as JSON {currency, issuer, value}. "" for XRP. */
  amount_iou: string;
  currency: string;
  issuer: string;
}

/** Delta counters per-account from a single ledger, for account_tx_counts upserts. */
export interface AccountCounterDelta {
  sent: number;
  received: number;
}

export interface ClassifiedLedger {
  ledgerIndex: number;
  txCount: number;
  chRows: CHTransaction[];
  chDexRows: CHDexTrade[];
  chTrustlineRows: CHTrustlineEvent[];
  /** One row per ledger with close metadata (close_time, fees, validators, hashes).
   *  Powers /ledger/[index] without a live rippled call. May be null if the
   *  ledger payload was malformed. */
  chLedgerMetadata: CHLedgerMetadata | null;
  /** AMM state-change events extracted from AMM tx metadata (one row per
   *  AMM* tx: AMMCreate, Deposit, Withdraw, Vote, Bid, Delete, Clawback).
   *  Source-of-truth for the amm_state_hourly materialized view. */
  chAmmStateChanges: CHAmmStateChange[];
  /** Unified value-transfer event log. One row per (tx, from→to, currency)
   *  for every tx that moves value between accounts (Payment, EscrowFinish,
   *  PaymentChannelClaim, CheckCash, AccountDelete, XChainClaim). System
   *  of record for cross-account flow analysis. */
  chValueTransferEvents: CHValueTransferEvent[];
  accountTimestamps: Map<string, number>;
  /** Per-account sent/received deltas for this ledger. Includes every submitter
   *  and every Payment destination (excluding self-payments). */
  accountCounterDeltas: Map<string, AccountCounterDelta>;
}

/* ------------------------------------------------------------------ */
/*  Pure classifier: expanded ledger → per-store row payloads          */
/* ------------------------------------------------------------------ */

/**
 * Walk an expanded ledger and produce flat row payloads for ClickHouse.
 * Pure: no I/O, no `this` references. Returns null when the ledger is
 * malformed (missing close_time or ledger_index).
 */
export function classifyLedger(result: ExpandedLedger): ClassifiedLedger | null {
  const ledger = result.ledger;
  if (ledger.close_time == null || ledger.ledger_index == null) return null;

  const ledgerIndex = ledger.ledger_index;
  const txs = (ledger.transactions ?? []) as RawLedgerTx[];

  const chRows: CHTransaction[] = [];
  const chDexRows: CHDexTrade[] = [];
  const chTrustlineRows: CHTrustlineEvent[] = [];
  const chAmmStateChanges: CHAmmStateChange[] = [];
  const chValueTransferEvents: CHValueTransferEvent[] = [];
  const accountTimestamps = new Map<string, number>();
  const accountCounterDeltas = new Map<string, AccountCounterDelta>();

  const bumpCounter = (addr: string, key: "sent" | "received") => {
    const existing = accountCounterDeltas.get(addr);
    if (existing) {
      existing[key]++;
    } else {
      accountCounterDeltas.set(addr, { sent: key === "sent" ? 1 : 0, received: key === "received" ? 1 : 0 });
    }
  };

  for (const rawTx of txs) {
    const txDate = rawTx.date ?? ledger.close_time;
    const txLedgerIndex = rawTx.ledger_index ?? ledgerIndex;

    const meta = rawTx.meta ?? rawTx.metaData;
    const txResult = meta?.TransactionResult ?? "";
    const isSuccess = txResult === "tesSUCCESS";
    const isPseudoTx = PSEUDO_TX_TYPES.has(rawTx.TransactionType);

    const unixTimestamp = txDate + XRPL_EPOCH;
    const isoDate = new Date(unixTimestamp * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);

    /* Pseudo-transactions (EnableAmendment, SetFee, UNLModify) have no
     * Account field — write the sentinel and skip account-keyed bookkeeping. */
    const accountForRow = isPseudoTx ? PSEUDO_TX_ACCOUNT : rawTx.Account;

    if (isSuccess && !isPseudoTx) {
      accountTimestamps.set(rawTx.Account, unixTimestamp);
      if (rawTx.Destination) {
        accountTimestamps.set(rawTx.Destination, unixTimestamp);
      }
    }

    /* Memo decoding. Captures MemoData (text) + MemoType (purpose hint, e.g.
     * "client", "label") + MemoFormat (encoding hint, e.g. "text/plain") for
     * the FIRST memo. Multi-memo arrays are <5% of txs and full data is in
     * tx_json if a consumer needs the others. All three fields hex-decoded;
     * memo (data) truncated to 500 chars to keep the column compact. */
    let memo = "";
    let memoType = "";
    let memoFormat = "";
    const memos = (rawTx as unknown as Record<string, unknown>).Memos as
      | Array<{ Memo?: { MemoData?: string; MemoType?: string; MemoFormat?: string } }>
      | undefined;
    const firstMemo = memos?.[0]?.Memo;
    if (firstMemo) {
      memo = decodeMemoField(firstMemo.MemoData).slice(0, 500);
      memoType = decodeMemoField(firstMemo.MemoType).slice(0, 100);
      memoFormat = decodeMemoField(firstMemo.MemoFormat).slice(0, 100);
    }

    /* Effective amount for the `amount_*` columns.
     *
     * For Payments we prefer `meta.delivered_amount` (what was actually
     * delivered after pathfinding/partial-payment) over `tx.Amount` (the
     * slippage ceiling). For all other tx types, `tx.Amount` is the only
     * meaningful value. parseXrplAmount() routes XRP via BigInt and IOU
     * via lossless JSON — see helper docstring. */
    const effectiveAmount =
      rawTx.TransactionType === "Payment" && meta?.delivered_amount
        ? meta.delivered_amount
        : rawTx.Amount;
    const parsed = parseXrplAmount(effectiveAmount);

    /* Phase 2 schema additions — populate from rawTx + meta. */
    const txJson = JSON.stringify(rawTx);
    const metaJson = meta ? JSON.stringify(meta) : "";
    const nftokenId = extractNftokenId(meta);

    const rawTxFields = rawTx as unknown as Record<string, unknown>;
    const flags = Number(rawTxFields.Flags ?? 0);
    const sequence = Number(rawTxFields.Sequence ?? 0);
    const sourceTag = Number(rawTxFields.SourceTag ?? 0);
    const destinationTag = Number(rawTxFields.DestinationTag ?? 0);

    /* Tier 1.5 (2026-04-28): top-level columns for queryable common fields
     * that previously required JSONExtract on tx_json. SigningPubKey is
     * empty string for multisig (the Signers array carries keys instead). */
    const lastLedgerSequence = Number(rawTxFields.LastLedgerSequence ?? 0);
    const ticketSequence = Number(rawTxFields.TicketSequence ?? 0);
    const signingPubKey = typeof rawTxFields.SigningPubKey === "string" ? rawTxFields.SigningPubKey : "";
    const networkId = Number(rawTxFields.NetworkID ?? 0);

    /* delivered_amount split — Payments only. tx.Amount is the slippage
     * ceiling, not what was delivered. For non-Payment tx types these
     * stay 0 / "". */
    const deliveredAmount =
      rawTx.TransactionType === "Payment" ? meta?.delivered_amount : undefined;
    const deliveredParsed = parseXrplAmount(deliveredAmount);

    chRows.push({
      tx_hash: rawTx.hash,
      tx_type: rawTx.TransactionType,
      account: accountForRow,
      destination: rawTx.Destination ?? "",
      amount_drops: parsed.drops.toString(),
      amount_iou: parsed.iou,
      currency: parsed.currency,
      issuer: parsed.issuer,
      fee_drops: Number(rawTx.Fee || "0"),
      timestamp: isoDate,
      ledger_index: ledgerIndex,
      result: txResult,
      memo,
      tx_json: txJson,
      meta_json: metaJson,
      nftoken_id: nftokenId,
      flags,
      sequence,
      source_tag: sourceTag,
      destination_tag: destinationTag,
      delivered_amount_drops: deliveredParsed.drops.toString(),
      delivered_amount_iou: deliveredParsed.iou,
      memo_type: memoType,
      memo_format: memoFormat,
      last_ledger_sequence: lastLedgerSequence,
      ticket_sequence: ticketSequence,
      signing_pub_key: signingPubKey,
      network_id: networkId,
    });

    /* Account counter bookkeeping (account_tx_counts in PG):
     *   - sent: every NON-PSEUDO tx — including failed ones, since the
     *     submitter DID submit the tx (rippled's account_tx returns
     *     failures, our counter should match).
     *   - received: only on SUCCESSFUL Payments. Tier 1.5 fixes (C5 + m-C):
     *     - Failed Payments don't deliver, so the recipient's "received"
     *       count should not bump. Pre-C5 code bumped on all Payments
     *       regardless of result, inflating counts.
     *     - Other tx types with a Destination field (OfferCreate's optional
     *       Destination, EscrowCreate, CheckCreate, etc.) DON'T deliver
     *       value to that destination — the field has different semantics
     *       per tx type. AccountDelete IS a value delivery but its
     *       beneficiary is tracked through value_transfer_events; the
     *       counter scope is intentionally Payment-only to match XRPL UX
     *       expectations of "incoming Payments." */
    if (!isPseudoTx) {
      if (rawTx.Account) bumpCounter(rawTx.Account, "sent");
      if (
        isSuccess &&
        rawTx.TransactionType === "Payment" &&
        rawTx.Destination &&
        rawTx.Destination !== rawTx.Account
      ) {
        bumpCounter(rawTx.Destination, "received");
      }
    }

    /* Unified value-transfer events. Captures every value-moving tx
     * (Payment, AccountDelete, CheckCash today; EscrowFinish/PayChan/
     * XChain in Tier 2). System of record for Neo4j PAYMENT edge
     * derivation — the live ingester both writes this CH table AND
     * projects to Neo4j; backfill writes only this table. */
    if (isSuccess) {
      const valueEvents = extractValueTransferEvents(
        rawTx,
        meta as { TransactionResult?: string; AffectedNodes?: Array<Record<string, unknown>>; delivered_amount?: string | CurrencyAmount } | undefined,
        ledgerIndex,
        isoDate,
      );
      for (const e of valueEvents) chValueTransferEvents.push(e);
    }

    /* DEX/AMM fill extraction. Fires for any successful tx that could touch
     * the order book or AMM. extractTokenTrades() now accepts both
     * OfferCreate AND Payment (cross-currency Payments pathfind through
     * book offers + AMM pools). The function itself gates on tx_type and
     * returns [] for non-trade txs. */
    if (
      isSuccess &&
      (rawTx.TransactionType === "OfferCreate" ||
        rawTx.TransactionType === "Payment")
    ) {
      const fills = extractTokenTrades(rawTx);
      for (let fillIdx = 0; fillIdx < fills.length; fillIdx++) {
        const fill = fills[fillIdx];
        if (fill.takerGetsCurrency === "XRP" && fill.takerPaysCurrency === "XRP") continue;

        const ts = (fill.date || txDate) + XRPL_EPOCH;
        const fillIso = new Date(ts * 1000)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19);

        const baseIsGets = fill.takerGetsCurrency !== "XRP";
        const baseCurrency = baseIsGets ? fill.takerGetsCurrency : fill.takerPaysCurrency;
        const baseIssuer = baseIsGets ? (fill.takerGetsIssuer ?? "") : (fill.takerPaysIssuer ?? "");
        /* Tier 1.5 (2026-04-28): keep base_amount/quote_amount as Float64
         * for chart aggregations, but ALSO populate base_amount_iou /
         * quote_amount_iou with the lossless decimal string when the side
         * is IOU. extractTokenTrades returns lossless string values from
         * subtractAmounts/addAmounts; Number() rounds at ~15.95 sig digits. */
        const baseValueStr = baseIsGets ? fill.takerGetsValue : fill.takerPaysValue;
        const baseAmount = Number(baseValueStr);
        const baseAmountIou = baseCurrency === "XRP" ? "" : baseValueStr;

        const quoteCurrency = baseIsGets ? fill.takerPaysCurrency : fill.takerGetsCurrency;
        const quoteIssuer = baseIsGets ? (fill.takerPaysIssuer ?? "") : (fill.takerGetsIssuer ?? "");
        const quoteValueStr = baseIsGets ? fill.takerPaysValue : fill.takerGetsValue;
        let quoteAmount = Number(quoteValueStr);
        // XRP values arrive as drops (1 XRP = 1,000,000 drops) — convert to XRP
        // so price is consistently denominated across all pairs.
        if (quoteCurrency === "XRP") {
          quoteAmount /= 1_000_000;
        }
        const quoteAmountIou = quoteCurrency === "XRP" ? "" : quoteValueStr;
        const price = baseAmount > 0 ? quoteAmount / baseAmount : 0;

        chDexRows.push({
          tx_hash: fill.txHash,
          fill_index: fillIdx,
          timestamp: fillIso,
          ledger_index: fill.ledgerIndex || txLedgerIndex,
          taker: fill.account,
          maker: fill.makerAccount ?? "",
          base_currency: baseCurrency,
          base_issuer: baseIssuer,
          base_amount: baseAmount,
          base_amount_iou: baseAmountIou,
          quote_currency: quoteCurrency,
          quote_issuer: quoteIssuer,
          quote_amount: quoteAmount,
          quote_amount_iou: quoteAmountIou,
          price,
          xrp_volume_drops: (fill.xrpVolumeDrops ?? 0n).toString(),
        });

        if (fill.makerAccount) {
          accountTimestamps.set(fill.account, ts);
          accountTimestamps.set(fill.makerAccount, ts);
        }
      }
    }

    if (isSuccess && rawTx.TransactionType === "TrustSet") {
      const limitAmount = (rawTx as unknown as Record<string, unknown>).LimitAmount as
        | CurrencyAmount
        | undefined;
      if (limitAmount) {
        const limitValue = Number(limitAmount.value ?? "0");
        chTrustlineRows.push({
          tx_hash: rawTx.hash,
          ledger_index: ledgerIndex,
          timestamp: isoDate,
          account: rawTx.Account,
          currency: limitAmount.currency ?? "",
          issuer: limitAmount.issuer ?? "",
          limit_amount: limitValue,
          action: limitValue === 0 ? "delete" : "set",
        });
      }
    }

    /* AMM state-change extraction. Fires only on AMM management ops:
     *   AMMCreate, AMMDeposit, AMMWithdraw, AMMVote, AMMBid, AMMDelete,
     *   AMMClawback. Payment/OfferCreate-driven AMM swaps are recorded in
     *   dex_trades (via extractAmmFillsFromTx in trade-extractors.ts) —
     *   amm_state_changes is the management-op event log, not a swap log.
     *
     * Gated on amendment activation: AMM didn't exist before ledger
     * 86,795,265 and AMMClawback before 93,814,273. For pre-amendment
     * ledgers the AMM* tx types literally don't exist, so this branch
     * never fires. */
    if (isSuccess && rawTx.TransactionType.startsWith("AMM")) {
      const amendmentName =
        rawTx.TransactionType === "AMMClawback" ? "AMMClawback" : "AMM";
      if (isAmendmentActive(amendmentName, ledgerIndex)) {
        const ammRows = extractAmmStateChanges(
          rawTx,
          meta as { AffectedNodes?: Array<Record<string, unknown>> } | undefined,
          ledgerIndex,
          isoDate,
          rawTx.hash,
        );
        for (const r of ammRows) chAmmStateChanges.push(r);
      }
    }
  }

  /* Ledger close metadata — one row per ledger. close_time is the same
   * across all txs in this ledger, so derive it from ledger.close_time. */
  const ledgerCloseUnix = ledger.close_time + XRPL_EPOCH;
  const ledgerCloseIso = new Date(ledgerCloseUnix * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const chLedgerMetadata = buildLedgerMetadata(result, ledgerCloseIso);

  return {
    ledgerIndex,
    txCount: txs.length,
    chRows,
    chDexRows,
    chTrustlineRows,
    chLedgerMetadata,
    chAmmStateChanges,
    chValueTransferEvents,
    accountTimestamps,
    accountCounterDeltas,
  };
}

/* ------------------------------------------------------------------ */
/*  Manager class                                                      */
/* ------------------------------------------------------------------ */

class IntelIngestionManager {
  private running = false;
  private processing = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private chEnabled = false;
  private chConfigured = false;
  private lastIntelLedger = 0;
  private failureCounts = new Map<number, number>();

  async start(): Promise<void> {
    if (this.running) return;

    if (process.env.ENABLE_INGESTION !== "true") {
      log.info("Intel ingestion disabled (ENABLE_INGESTION !== true)");
      return;
    }

    this.chConfigured = !!process.env.CLICKHOUSE_URL;

    if (!this.chConfigured) {
      log.info("Intel ingestion disabled (no CLICKHOUSE_URL)");
      return;
    }

    await this.checkConnectivity();

    if (!this.chEnabled) {
      log.warn("ClickHouse unreachable at startup — will retry every 60s");
      this.startConnectivityRetry();
      return;
    }

    await this.beginPolling();
  }

  /** Check which configured stores are reachable. */
  private async checkConnectivity(): Promise<void> {
    if (this.chConfigured && !this.chEnabled) {
      const ok = await ch.verifyConnectivity();
      if (ok) {
        this.chEnabled = true;
        log.info("ClickHouse connected");
      } else {
        log.warn("ClickHouse unreachable");
      }
    }
  }

  /** Retry connectivity periodically until ClickHouse is available. */
  private startConnectivityRetry(): void {
    if (this.retryTimer) return;
    // CRITICAL: setInterval(async () => ...) — if the body rejects, the
    // returned promise has no consumer and becomes an unhandledRejection
    // that crashes the Node process under newer defaults (and crash-loops
    // the systemd unit). Wrap the body in a try/catch so the next tick
    // can still retry. Same shape as the xrplClient .finally() bug we
    // shipped a fix for in commit a5fa56e.
    this.retryTimer = setInterval(async () => {
      try {
        await this.checkConnectivity();
        if (this.chEnabled) {
          clearInterval(this.retryTimer!);
          this.retryTimer = null;
          log.info("ClickHouse now reachable — starting ingestion");
          await this.beginPolling();
        }
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : err }, "Connectivity retry tick failed");
      }
    }, CONNECTIVITY_RETRY_INTERVAL);
  }

  /** Load the intel pointer and start the poll loop. */
  private async beginPolling(): Promise<void> {
    // Load last processed intel ledger
    try {
      const [row] = await db
        .select()
        .from(ingestionState)
        .where(sql`${ingestionState.key} = 'intel_latest_ledger'`)
        .limit(1);
      this.lastIntelLedger = row ? Number(row.value) : 0;
    } catch {
      this.lastIntelLedger = 0;
    }

    this.running = true;
    log.info(
      { clickhouse: this.chEnabled, lastLedger: this.lastIntelLedger },
      "Intel ingestion starting",
    );

    // Poll for new ledgers
    this.pollTimer = setInterval(() => {
      if (this.processing) return;
      this.processing = true;
      this.processNewLedgers()
        .catch((err) => log.error({ err }, "Intel poll cycle error"))
        .finally(() => { this.processing = false; });
    }, POLL_INTERVAL);

    // Run immediately
    this.processing = true;
    this.processNewLedgers()
      .catch((err) => log.error({ err }, "Intel initial cycle error"))
      .finally(() => { this.processing = false; });
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    log.info("Intel ingestion stopped");
  }

  /** Find ledgers ingested by main pipeline but not yet by intel. */
  private async processNewLedgers(): Promise<void> {
    if (!this.running) return;

    const rows = await db
      .select({ ledgerIndex: ingestedLedgers.ledgerIndex })
      .from(ingestedLedgers)
      .where(sql`${ingestedLedgers.ledgerIndex} > ${this.lastIntelLedger}`)
      .orderBy(sql`${ingestedLedgers.ledgerIndex} ASC`)
      .limit(BATCH_SIZE);

    if (rows.length === 0) return;

    // Advance pointer past any ledgers that have exhausted retries — almost
    // always malformed responses from XRPL. Rare but we don't want them to
    // stall the pipeline forever.
    const candidates = rows.map(r => r.ledgerIndex);
    const fresh: number[] = [];
    const skipped: number[] = [];
    for (const idx of candidates) {
      if ((this.failureCounts.get(idx) ?? 0) >= MAX_RETRIES_PER_LEDGER) {
        skipped.push(idx);
      } else {
        fresh.push(idx);
      }
    }
    if (skipped.length > 0) {
      log.error(
        { skipped, failures: MAX_RETRIES_PER_LEDGER },
        "Skipping ledgers after max retries — advancing pointer",
      );
      for (const idx of skipped) this.failureCounts.delete(idx);
      const maxSkipped = Math.max(...skipped);
      this.lastIntelLedger = Math.max(this.lastIntelLedger, maxSkipped);
      await this.persistPointer(this.lastIntelLedger);
    }
    if (fresh.length === 0) return;

    await this.processBatch(fresh);
  }

  private async processBatch(indices: number[]): Promise<void> {
    // ── 1. Fetch in parallel (bounded concurrency) ──
    const fetched = new Map<number, ExpandedLedger>();
    for (let i = 0; i < indices.length; i += FETCH_CONCURRENCY) {
      if (!this.running) return;
      const chunk = indices.slice(i, i + FETCH_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (idx) => {
        try {
          const res = (await getIngestionClient().getLedger(idx, true)) as ExpandedLedger;
          return { idx, res } as const;
        } catch (err) {
          log.warn({ err, ledgerIndex: idx }, "Failed to fetch ledger for intel");
          this.failureCounts.set(idx, (this.failureCounts.get(idx) ?? 0) + 1);
          return { idx, res: null } as const;
        }
      }));
      for (const { idx, res } of results) if (res) fetched.set(idx, res);
    }

    // ── 2. Classify (drop malformed, bump their failure counts) ──
    const classified: ClassifiedLedger[] = [];
    for (const idx of indices) {
      const res = fetched.get(idx);
      if (!res) continue;
      const cls = classifyLedger(res);
      if (!cls) {
        log.warn({ ledgerIndex: idx }, "Ledger missing close_time or ledger_index, skipping");
        this.failureCounts.set(idx, (this.failureCounts.get(idx) ?? 0) + 1);
        continue;
      }
      classified.push(cls);
    }
    if (classified.length === 0) return;

    // ── 3. Dedup accounts across the batch (max timestamp wins) ──
    const batchAccounts = new Map<string, number>();
    for (const c of classified) {
      for (const [addr, ts] of c.accountTimestamps) {
        const existing = batchAccounts.get(addr);
        if (existing === undefined || ts > existing) batchAccounts.set(addr, ts);
      }
    }

    // ── 4. Flatten write payloads ──
    const minLedger = classified[0].ledgerIndex;
    const maxLedger = classified[classified.length - 1].ledgerIndex;
    const allChRows = classified.flatMap(c => c.chRows);
    const allChDexRows = classified.flatMap(c => c.chDexRows);
    const allChTrustlines = classified.flatMap(c => c.chTrustlineRows);
    const allChLedgerMetadata = classified
      .map(c => c.chLedgerMetadata)
      .filter((m): m is CHLedgerMetadata => m !== null);
    const allChAmmStateChanges = classified.flatMap(c => c.chAmmStateChanges);
    const allChValueTransferEvents = classified.flatMap(c => c.chValueTransferEvents);

    // ── 5. ClickHouse flush ──
    // Dedup probe — query `transactions` (every ledger appears there)
    // rather than `dex_trades` (payment-only ledgers probe empty and
    // re-process on every restart, double-feeding SummingMergeTree
    // aggregations like mv_hourly_tx_volume that can't un-sum). Phase 2
    // audit fix.
    // Uses BETWEEN (not IN) — the batch is contiguous-or-near-contiguous
    // and the ClickHouse client's Array(UInt32) parameter serialization
    // quotes integers in a way the parser rejects.
    let chOk = true;
    // Ledgers whose CH rows were skipped because the data was already
    // written on a previous retry. We use this set to filter the account
    // counter upserts so they don't double-count on retry.
    let alreadyWrittenLedgers = new Set<number>();
    if (this.chEnabled) {
      try {
        const existing = await ch.query<{ ledger_index: number }>(
          `SELECT DISTINCT ledger_index FROM transactions WHERE ledger_index BETWEEN {min:UInt32} AND {max:UInt32}`,
          { min: minLedger, max: maxLedger },
        );
        alreadyWrittenLedgers = new Set(existing.map(r => Number(r.ledger_index)));
        const freshChRows = alreadyWrittenLedgers.size === 0
          ? allChRows
          : allChRows.filter(r => !alreadyWrittenLedgers.has(r.ledger_index));
        const freshChDexRows = alreadyWrittenLedgers.size === 0
          ? allChDexRows
          : allChDexRows.filter(r => !alreadyWrittenLedgers.has(r.ledger_index));
        // Trustline dedup gap fix (Phase 2 audit): trustlines now respect
        // the same alreadyWritten filter as transactions/dex_trades.
        // Without this, restart mid-batch double-writes trustline rows
        // and mv_trustline_counts (SummingMergeTree) inflates permanently.
        const freshChTrustlines = alreadyWrittenLedgers.size === 0
          ? allChTrustlines
          : allChTrustlines.filter(r => !alreadyWrittenLedgers.has(r.ledger_index));
        const freshChLedgerMetadata = alreadyWrittenLedgers.size === 0
          ? allChLedgerMetadata
          : allChLedgerMetadata.filter(r => !alreadyWrittenLedgers.has(r.ledger_index));
        const freshChAmmStateChanges = alreadyWrittenLedgers.size === 0
          ? allChAmmStateChanges
          : allChAmmStateChanges.filter(r => !alreadyWrittenLedgers.has(r.ledger_index));
        const freshChValueTransferEvents = alreadyWrittenLedgers.size === 0
          ? allChValueTransferEvents
          : allChValueTransferEvents.filter(r => !alreadyWrittenLedgers.has(r.ledger_index));

        const inserts: Promise<unknown>[] = [];
        if (freshChRows.length > 0) inserts.push(ch.insert("transactions", freshChRows));
        if (freshChDexRows.length > 0) inserts.push(ch.insert("dex_trades", freshChDexRows));
        if (freshChTrustlines.length > 0) {
          // Trustline failures don't block the main pipeline.
          inserts.push(ch.insert("trustline_events", freshChTrustlines).catch((err) => {
            log.warn({ err, count: freshChTrustlines.length }, "Trustline events insert failed");
          }));
        }
        if (freshChLedgerMetadata.length > 0) {
          inserts.push(ch.insert("ledger_metadata", freshChLedgerMetadata).catch((err) => {
            log.warn({ err, count: freshChLedgerMetadata.length }, "Ledger metadata insert failed");
          }));
        }
        if (freshChAmmStateChanges.length > 0) {
          inserts.push(ch.insert("amm_state_changes", freshChAmmStateChanges).catch((err) => {
            log.warn({ err, count: freshChAmmStateChanges.length }, "AMM state-changes insert failed");
          }));
        }
        if (freshChValueTransferEvents.length > 0) {
          inserts.push(ch.insert("value_transfer_events", freshChValueTransferEvents).catch((err) => {
            log.warn({ err, count: freshChValueTransferEvents.length }, "value_transfer_events insert failed");
          }));
        }
        if (inserts.length > 0) await Promise.all(inserts);
      } catch (err) {
        log.error({ err, batchSize: classified.length }, "ClickHouse batch insert failed");
        chOk = false;
      }
    }

    // ── 6. Pointer advance ──
    const allOk = !this.chEnabled || chOk;
    if (!allOk) {
      for (const c of classified) {
        this.failureCounts.set(c.ledgerIndex, (this.failureCounts.get(c.ledgerIndex) ?? 0) + 1);
      }
      log.warn(
        {
          chOk,
          batchSize: classified.length,
          firstLedger: classified[0].ledgerIndex,
          lastLedger: classified[classified.length - 1].ledgerIndex,
        },
        "Batch failed — will retry",
      );
      await this.checkStoreHealthAfterFailure(chOk);
      return;
    }

    // Success: clear retry counters, advance pointer, emit per-ledger logs.
    for (const c of classified) this.failureCounts.delete(c.ledgerIndex);
    for (const c of classified) {
      log.info(
        {
          ledgerIndex: c.ledgerIndex,
          txs: c.txCount,
          chRows: c.chRows.length,
          chDexRows: c.chDexRows.length,
          chTrustlines: c.chTrustlineRows.length,
          chValueTransferEvents: c.chValueTransferEvents.length,
          accountsTouched: c.accountTimestamps.size,
        },
        "Intel ledger ingested",
      );
    }

    // ── 7b. Account counter upserts ──
    // PG account_tx_counts upsert was here pre-2026-05-09. The counter
    // is now an AggregatingMergeTree in CH (`account_tx_counts`) populated
    // by two materialized views from `transactions` (sender side) and
    // `value_transfer_events` (receiver side). Live counts auto-update
    // via those MVs without needing an explicit write here. See
    // `docs/plans/pg-to-ch-migration-2026-05-09.md` Phase 2.

    const lastLedger = classified[classified.length - 1].ledgerIndex;
    this.lastIntelLedger = lastLedger;
    await this.persistPointer(lastLedger);
  }

  private async persistPointer(ledgerIndex: number): Promise<void> {
    try {
      await db
        .insert(ingestionState)
        .values({
          key: "intel_latest_ledger",
          value: String(ledgerIndex),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: ingestionState.key,
          set: {
            value: String(ledgerIndex),
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      log.warn({ err, ledgerIndex }, "Failed to update intel_latest_ledger state");
    }
  }

  private async checkStoreHealthAfterFailure(chOk: boolean): Promise<void> {
    // When ledgers start piling up retries, re-check ClickHouse connectivity.
    // If it's unreachable, disable it and pause ingestion until it returns.
    const maxed = Array.from(this.failureCounts.values()).some((n) => n >= MAX_RETRIES_PER_LEDGER);
    if (!maxed) return;

    if (!chOk && this.chEnabled) {
      const reachable = await ch.verifyConnectivity();
      if (!reachable) {
        log.warn("ClickHouse appears down — disabling until reconnected");
        this.chEnabled = false;
      }
    }
    if (!this.chEnabled) {
      log.warn("ClickHouse down — pausing ingestion, retrying connectivity every 60s");
      this.running = false;
      if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
      this.startConnectivityRetry();
    }
  }

}

/* ------------------------------------------------------------------ */
/*  Singleton + init                                                   */
/* ------------------------------------------------------------------ */

const globalForIntel = globalThis as unknown as {
  __intelIngestionManager?: IntelIngestionManager;
};

if (!globalForIntel.__intelIngestionManager) {
  globalForIntel.__intelIngestionManager = new IntelIngestionManager();
}

const manager = globalForIntel.__intelIngestionManager;

export async function initIntelIngestion(): Promise<void> {
  await manager.start();
}
