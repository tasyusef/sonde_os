/**
 * Trade extraction logic for the Sonde ingestion pipeline.
 *
 * Extracts real trade data from XRPL transaction metadata:
 * - NFT trades from NFTokenAcceptOffer (excludes mints, burns, free transfers)
 * - Token/DEX trades from OfferCreate (only fills that crossed the book)
 */

import "server-only";
import { parseNFTokenID } from "./nft-utils";
import type {
  RawLedgerTx,
  AffectedNode,
  NFTTradeRow,
  TokenTradeRow,
  PaymentCorridorRow,
  CurrencyAmount,
} from "@/types/ingestion";

/** XRPL epoch offset: seconds between Unix epoch and XRPL epoch (2000-01-01) */
const RIPPLE_EPOCH = 946684800;

/** NFTokenOffer flag: lsfSellNFToken */
const LSF_SELL_NFTOKEN = 0x0001;

/* ------------------------------------------------------------------ */
/*  NFT Trade Extraction                                               */
/* ------------------------------------------------------------------ */

/**
 * Extract an NFT trade from an NFTokenAcceptOffer transaction.
 *
 * Returns null if:
 * - Transaction is not NFTokenAcceptOffer
 * - Transaction failed (not tesSUCCESS)
 * - No value exchanged (free transfer)
 * - Cannot determine NFT ID or buyer/seller
 */
export function extractNFTTrade(
  tx: RawLedgerTx,
  marketplaceMap: Map<string, string>,
): NFTTradeRow | null {
  if (tx.TransactionType !== "NFTokenAcceptOffer") return null;

  const meta = tx.meta ?? tx.metaData;
  if (!meta || meta.TransactionResult !== "tesSUCCESS") return null;

  const nodes = meta.AffectedNodes ?? [];

  // Find deleted NFTokenOffer nodes — these are the consumed offers
  const deletedOffers = findDeletedNFTokenOffers(nodes);
  if (deletedOffers.length === 0) return null;

  // Determine trade participants and amount
  const isBrokered = tx.NFTokenSellOffer && tx.NFTokenBuyOffer;

  let seller: string | null = null;
  let buyer: string | null = null;
  let broker: string | null = null;
  let nftId: string | null = meta.nftoken_id ?? null;
  let amount: string | { value: string; currency: string; issuer: string } | null = null;

  if (isBrokered) {
    // Brokered trade: tx.Account is the broker
    broker = tx.Account;
    for (const offer of deletedOffers) {
      const flags = Number(offer.Flags ?? 0);
      if (flags & LSF_SELL_NFTOKEN) {
        seller = String(offer.Owner ?? "");
      } else {
        buyer = String(offer.Owner ?? "");
        // Use the buy offer amount (what buyer paid)
        amount = offer.Amount as typeof amount;
      }
      if (!nftId) nftId = String(offer.NFTokenID ?? "");
    }
  } else {
    // Direct trade: tx.Account is accepting a single offer
    const offer = deletedOffers[0];
    const flags = Number(offer.Flags ?? 0);
    if (flags & LSF_SELL_NFTOKEN) {
      // Accepting a sell offer
      seller = String(offer.Owner ?? "");
      buyer = tx.Account;
    } else {
      // Accepting a buy offer
      buyer = String(offer.Owner ?? "");
      seller = tx.Account;
    }
    amount = offer.Amount as typeof amount;
    if (!nftId) nftId = String(offer.NFTokenID ?? "");
  }

  if (!seller || !buyer || !nftId) return null;

  // Parse the amount — skip zero-value transfers (free gifts)
  const parsed = parseAmount(amount);
  if (!parsed) return null;
  if (parsed.isXrp && parsed.drops === 0n) return null;
  if (!parsed.isXrp && parseFloat(parsed.value) === 0) return null;

  // Parse NFTokenID for issuer and taxon
  const nftParsed = parseNFTokenID(nftId);
  if (!nftParsed) return null;

  // Marketplace attribution
  let marketplace: string | null = null;
  if (broker && marketplaceMap.has(broker)) {
    marketplace = marketplaceMap.get(broker)!;
  } else if (marketplaceMap.has(tx.Account)) {
    marketplace = marketplaceMap.get(tx.Account)!;
  }

  const txDate = tx.date ?? 0;
  const dateIso = new Date((txDate + RIPPLE_EPOCH) * 1000);

  return {
    txHash: tx.hash,
    nftId,
    seller,
    buyer,
    broker,
    amountDrops: parsed.isXrp ? parsed.drops : null,
    amountValue: parsed.isXrp ? null : parsed.value,
    amountCurrency: parsed.isXrp ? null : parsed.currency,
    amountIssuer: parsed.isXrp ? null : parsed.issuer,
    isXrp: parsed.isXrp,
    issuer: nftParsed.issuer,
    taxon: nftParsed.nft_taxon,
    marketplace,
    ledgerIndex: tx.ledger_index ?? 0,
    date: txDate,
    dateIso,
  };
}

/* ------------------------------------------------------------------ */
/*  Token/DEX Trade Extraction                                         */
/* ------------------------------------------------------------------ */

/**
 * Extract token trades (fills) from any tx that touched the DEX or AMM.
 *
 * Sources of fills:
 *   1. **OfferCreate** crossing resting book offers → consumes Offer entries
 *   2. **OfferCreate** routing through an AMM (post-AMM amendment, AMM may be
 *      cheaper than the book) → consumes AMM liquidity
 *   3. **Payment** with cross-currency pathfinding → may consume Offers,
 *      AMM liquidity, or both
 *
 * One transaction can produce multiple fill rows: a Payment may pathfind
 * through several offers and AMMs, each becoming its own row.
 *
 * Skip rules:
 *   - tx.Account-owned Offers (those are cancellations/replacements, not fills)
 *   - Zero-value fills
 *   - Failed txs (only successful crossings count)
 *
 * Pre-fix history: this function used to gate on `OfferCreate` only, which
 * silently dropped EVERY DEX-routed Payment trade (book + AMM). The Phase 2
 * audit (2026-04-28) found this excluded the bulk of cross-currency volume.
 */
export function extractTokenTrades(tx: RawLedgerTx): TokenTradeRow[] {
  if (tx.TransactionType !== "OfferCreate" && tx.TransactionType !== "Payment") {
    return [];
  }

  const meta = tx.meta ?? tx.metaData;
  if (!meta || meta.TransactionResult !== "tesSUCCESS") return [];

  const nodes = meta.AffectedNodes ?? [];
  const trades: TokenTradeRow[] = [];
  const txDate = tx.date ?? 0;
  const dateIso = new Date((txDate + RIPPLE_EPOCH) * 1000);

  /* Per-node Offer fills (DEX book crossings).
   *
   * AMM fills are NOT detected per-node — they need a tx-level walk because
   * AMM swaps don't appear as ModifiedNodes on the AMM ledger entry; they
   * manifest as AccountRoot + RippleState mutations on the AMM's pseudo-
   * account. See extractAmmFillsFromTx below. */
  for (const node of nodes) {
    const fill = extractFillFromNode(node, tx.Account);
    if (!fill) continue;

    const gets = normalizeCurrencyAmount(fill.takerGets);
    const pays = normalizeCurrencyAmount(fill.takerPays);
    if (!gets || !pays) continue;

    // Skip zero fills
    if (gets.value === "0" && pays.value === "0") continue;

    const isXrpPair = gets.currency === "XRP" || pays.currency === "XRP";
    let xrpVolumeDrops: bigint | null = null;

    if (gets.currency === "XRP") {
      xrpVolumeDrops = parseDrops(gets.value);
    } else if (pays.currency === "XRP") {
      xrpVolumeDrops = parseDrops(pays.value);
    }

    trades.push({
      txHash: tx.hash,
      account: tx.Account,
      makerAccount: fill.makerAccount,
      takerGetsCurrency: gets.currency,
      takerGetsIssuer: gets.issuer,
      takerGetsValue: gets.value,
      takerPaysCurrency: pays.currency,
      takerPaysIssuer: pays.issuer,
      takerPaysValue: pays.value,
      isXrpPair,
      xrpVolumeDrops,
      ledgerIndex: tx.ledger_index ?? 0,
      date: txDate,
      dateIso,
    });
  }

  /* AMM fills (one per pool the tx swapped through). */
  const ammFills = extractAmmFillsFromTx(tx);
  for (const fill of ammFills) {
    const gets = normalizeCurrencyAmount(fill.takerGets);
    const pays = normalizeCurrencyAmount(fill.takerPays);
    if (!gets || !pays) continue;
    if (gets.value === "0" && pays.value === "0") continue;

    const isXrpPair = gets.currency === "XRP" || pays.currency === "XRP";
    let xrpVolumeDrops: bigint | null = null;
    if (gets.currency === "XRP") xrpVolumeDrops = parseDrops(gets.value);
    else if (pays.currency === "XRP") xrpVolumeDrops = parseDrops(pays.value);

    trades.push({
      txHash: tx.hash,
      account: tx.Account,
      makerAccount: fill.makerAccount,
      takerGetsCurrency: gets.currency,
      takerGetsIssuer: gets.issuer,
      takerGetsValue: gets.value,
      takerPaysCurrency: pays.currency,
      takerPaysIssuer: pays.issuer,
      takerPaysValue: pays.value,
      isXrpPair,
      xrpVolumeDrops,
      ledgerIndex: tx.ledger_index ?? 0,
      date: txDate,
      dateIso,
    });
  }

  return trades;
}

/* ------------------------------------------------------------------ */
/*  Payment Corridor Extraction                                         */
/* ------------------------------------------------------------------ */

/**
 * Extract a cross-currency payment corridor from a Payment transaction.
 *
 * v1 simplification: only counts corridors where XRP is on at least one side
 * (vast majority of cross-currency payments on XRPL).
 *
 * Returns null if:
 * - Transaction is not Payment
 * - Same-currency payment (not cross-currency)
 * - Neither side is XRP
 */
export function extractPaymentCorridor(
  tx: RawLedgerTx,
): PaymentCorridorRow | null {
  if (tx.TransactionType !== "Payment") return null;

  const meta = tx.meta ?? tx.metaData;
  if (!meta || meta.TransactionResult !== "tesSUCCESS") return null;

  // Determine destination currency from delivered_amount (most accurate)
  // Fallback to tx.Amount
  const delivered = meta.delivered_amount ?? tx.Amount;
  if (!delivered) return null;

  const dstParsed = parseCurrencyField(delivered);
  if (!dstParsed) return null;

  // Determine source currency
  // If SendMax is present, that's the source currency
  // Otherwise check if Amount differs from delivered (cross-currency via pathfinding)
  let srcParsed: { currency: string; issuer: string } | null = null;

  if (tx.SendMax) {
    srcParsed = parseCurrencyField(tx.SendMax);
  } else {
    // If no SendMax, source = destination (same currency payment)
    // Unless tx.Amount currency differs from delivered (rare edge case)
    const amtParsed = tx.Amount ? parseCurrencyField(tx.Amount) : null;
    if (amtParsed && (amtParsed.currency !== dstParsed.currency || amtParsed.issuer !== dstParsed.issuer)) {
      srcParsed = amtParsed;
    }
  }

  if (!srcParsed) return null;

  // Skip same-currency payments
  if (srcParsed.currency === dstParsed.currency && srcParsed.issuer === dstParsed.issuer) {
    return null;
  }

  // v1: only count corridors where XRP is on at least one side
  if (srcParsed.currency !== "XRP" && dstParsed.currency !== "XRP") {
    return null;
  }

  // Calculate XRP volume (the XRP side of the corridor)
  // Never use tx.SendMax — it's a slippage ceiling, not the actual amount spent.
  let xrpVolumeDrops = 0n;
  if (srcParsed.currency === "XRP") {
    // XRP is the source: compute actual spend from sender's balance change
    xrpVolumeDrops = getActualXrpSpent(tx.Account, meta.AffectedNodes ?? [], tx.Fee);
  } else if (dstParsed.currency === "XRP") {
    const deliveredStr = typeof delivered === "string" ? delivered : "0";
    xrpVolumeDrops = parseDropsSafe(deliveredStr);
  }

  const txDate = tx.date ?? 0;
  const dateIso = new Date((txDate + RIPPLE_EPOCH) * 1000);

  return {
    srcCurrency: srcParsed.currency,
    srcIssuer: srcParsed.issuer,
    dstCurrency: dstParsed.currency,
    dstIssuer: dstParsed.issuer,
    xrpVolumeDrops,
    dateIso,
  };
}

function parseCurrencyField(
  amount: string | CurrencyAmount,
): { currency: string; issuer: string } | null {
  if (typeof amount === "string") {
    return { currency: "XRP", issuer: "" };
  }
  if (typeof amount === "object" && amount !== null && amount.currency) {
    return { currency: amount.currency, issuer: amount.issuer ?? "" };
  }
  return null;
}

function parseDropsSafe(s: string): bigint {
  try {
    const clean = s.includes(".") ? s.split(".")[0] : s;
    return BigInt(clean);
  } catch {
    return 0n;
  }
}

/**
 * Calculate actual XRP spent by a sender in a cross-currency Payment.
 *
 * Looks at the sender's AccountRoot balance change in AffectedNodes,
 * then subtracts the transaction fee (which is burned, not transferred).
 * This gives the true XRP amount that entered the payment path —
 * unlike SendMax which is just a slippage ceiling.
 */
function getActualXrpSpent(
  sender: string,
  nodes: AffectedNode[],
  fee: string,
): bigint {
  for (const node of nodes) {
    const modified = node.ModifiedNode;
    if (modified?.LedgerEntryType !== "AccountRoot") continue;

    const final = modified.FinalFields as Record<string, unknown> | undefined;
    const prev = modified.PreviousFields as Record<string, unknown> | undefined;
    if (!final || !prev) continue;

    // Match the sender's account
    if (final.Account !== sender) continue;

    const prevBalance = parseDropsSafe(String(prev.Balance ?? "0"));
    const finalBalance = parseDropsSafe(String(final.Balance ?? "0"));
    const feeDrops = parseDropsSafe(fee);

    // Balance decrease = payment amount + fee, so subtract fee
    const spent = prevBalance - finalBalance - feeDrops;
    return spent > 0n ? spent : 0n;
  }
  return 0n;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                    */
/* ------------------------------------------------------------------ */

interface ParsedAmount {
  isXrp: boolean;
  drops: bigint;
  value: string;
  currency: string | null;
  issuer: string | null;
}

function parseAmount(
  amount: unknown,
): ParsedAmount | null {
  if (amount == null) return null;

  if (typeof amount === "string") {
    // XRP in drops (string)
    const drops = parseDrops(amount);
    return { isXrp: true, drops, value: amount, currency: null, issuer: null };
  }

  if (typeof amount === "number") {
    // XRP in drops (number — XRPL AffectedNodes may use numeric amounts)
    const drops = BigInt(Math.round(amount));
    return { isXrp: true, drops, value: String(amount), currency: null, issuer: null };
  }

  if (typeof amount === "object") {
    const obj = amount as { value?: string; currency?: string; issuer?: string };
    if (!obj.value || !obj.currency) return null;
    return {
      isXrp: false,
      drops: 0n,
      value: obj.value,
      currency: obj.currency,
      issuer: obj.issuer ?? null,
    };
  }

  return null;
}

function parseDrops(s: string): bigint {
  try {
    // Strip any decimal point (shouldn't be present for drops, but defensive)
    const clean = s.includes(".") ? s.split(".")[0] : s;
    return BigInt(clean);
  } catch {
    return 0n;
  }
}

interface NFTokenOfferFields {
  Owner?: unknown;
  Amount?: unknown;
  NFTokenID?: unknown;
  Flags?: unknown;
  Destination?: unknown;
}

function findDeletedNFTokenOffers(nodes: AffectedNode[]): NFTokenOfferFields[] {
  const offers: NFTokenOfferFields[] = [];
  for (const node of nodes) {
    if (node.DeletedNode?.LedgerEntryType === "NFTokenOffer") {
      const fields = node.DeletedNode.FinalFields as NFTokenOfferFields | undefined;
      if (fields) offers.push(fields);
    }
  }
  return offers;
}

interface Fill {
  takerGets: unknown;
  takerPays: unknown;
  makerAccount: string | null;
}

/**
 * Extract a single fill from an AffectedNode that represents a consumed
 * or partially consumed Offer on the DEX.
 *
 * @param txAccount - The OfferCreate sender. Deleted offers owned by this
 *   account are cancelled/replaced offers, NOT consumed fills — skip them.
 */
function extractFillFromNode(node: AffectedNode, txAccount: string): Fill | null {
  const deleted = node.DeletedNode;
  const modified = node.ModifiedNode;

  if (deleted?.LedgerEntryType === "Offer") {
    const prev = deleted.PreviousFields as Record<string, unknown> | undefined;
    const final = deleted.FinalFields as Record<string, unknown> | undefined;
    if (!final) return null;

    // Skip cancelled/replaced offers: when an OfferCreate replaces the
    // sender's own previous offer, the old offer is deleted but NOT consumed.
    // These show up as DeletedNode Offers owned by txAccount.
    const offerOwner = final.Account as string | undefined;
    if (offerOwner === txAccount) return null;

    // CRITICAL: a DeletedNode Offer is only a real fill when this tx
    // changed its state (i.e., consumed it). rippled also emits
    // DeletedNodes for offers it garbage-collects during pathfinding —
    // notably "unfunded offers" whose owner can't honor them. Those
    // deletions have NO PreviousFields (nothing changed in this tx,
    // the offer is just being cleaned up) and FinalFields contains the
    // offer's original untraded amounts. Reading FinalFields as the
    // fill volume produces fake billion-XRP "trades".
    //
    // Truth source: a real fill always has PreviousFields with the
    // pre-consumption TakerGets/TakerPays, and the consumed amount is
    // PreviousFields - FinalFields. If PreviousFields is missing, this
    // node didn't represent a state change → not a fill.
    if (!prev?.TakerGets || !prev?.TakerPays) return null;

    const prevGets = normalizeCurrencyAmount(prev.TakerGets);
    const finalGets = normalizeCurrencyAmount(final.TakerGets);
    const prevPays = normalizeCurrencyAmount(prev.TakerPays);
    const finalPays = normalizeCurrencyAmount(final.TakerPays);
    if (!prevGets || !finalGets || !prevPays || !finalPays) return null;

    // Consumed in this tx = prev - final. For a fully-consumed offer
    // FinalFields will be 0 and the diff equals prev (matches old
    // behavior); for any other case the diff is the precise fill.
    const getsValue = subtractAmounts(prevGets.value, finalGets.value);
    const paysValue = subtractAmounts(prevPays.value, finalPays.value);
    if (getsValue === "0" && paysValue === "0") return null;

    const takerGets =
      prevGets.currency === "XRP"
        ? getsValue
        : { value: getsValue, currency: prevGets.currency, issuer: prevGets.issuer };
    const takerPays =
      prevPays.currency === "XRP"
        ? paysValue
        : { value: paysValue, currency: prevPays.currency, issuer: prevPays.issuer };

    const makerAccount = (offerOwner as string) ?? null;
    return { takerGets, takerPays, makerAccount };
  }

  if (modified?.LedgerEntryType === "Offer") {
    // Partially consumed offer — fill = previous - final
    const prev = modified.PreviousFields as Record<string, unknown> | undefined;
    const final = modified.FinalFields as Record<string, unknown> | undefined;
    if (!prev?.TakerGets || !final?.TakerGets) return null;

    // Skip the sender's own offer being partially consumed (self-trade edge case)
    const modOwner = final.Account as string | undefined;
    if (modOwner === txAccount) return null;

    const prevGets = normalizeCurrencyAmount(prev.TakerGets);
    const finalGets = normalizeCurrencyAmount(final.TakerGets);
    const prevPays = normalizeCurrencyAmount(prev.TakerPays);
    const finalPays = normalizeCurrencyAmount(final.TakerPays);

    if (!prevGets || !finalGets || !prevPays || !finalPays) return null;

    // Compute the difference (what was consumed)
    const getsValue = subtractAmounts(prevGets.value, finalGets.value);
    const paysValue = subtractAmounts(prevPays.value, finalPays.value);

    // Reconstruct the fill as currency amounts
    const takerGets =
      prevGets.currency === "XRP"
        ? getsValue
        : { value: getsValue, currency: prevGets.currency, issuer: prevGets.issuer };
    const takerPays =
      prevPays.currency === "XRP"
        ? paysValue
        : { value: paysValue, currency: prevPays.currency, issuer: prevPays.issuer };

    const makerAccount2 = (modOwner as string) ?? null;
    return { takerGets, takerPays, makerAccount: makerAccount2 };
  }

  return null;
}

/**
 * Extract AMM-driven swap fills from a transaction's full meta.
 *
 * AMM swap fills do NOT appear as ModifiedNodes on the AMM ledger entry —
 * the AMM ledger object only stores `Asset`/`Asset2` (currency definitions),
 * `LPTokenBalance`, `TradingFee`, and vote/auction state. The actual reserve
 * amounts are stored via the AMM's pseudo-account:
 *   - XRP side → AccountRoot.Balance on the AMM's address
 *   - IOU side → RippleState (trustline) between the AMM and the issuer
 *
 * For a swap, rippled mutates these underlying entries directly without
 * touching the AMM ledger object. So per-node fill extraction (which works
 * for Offer entries) misses AMM swaps entirely. We need a tx-level walk.
 *
 * Algorithm:
 *   1. Find every AccountRoot ModifiedNode with `AMMID` set — these are
 *      AMM accounts the tx touched.
 *   2. For each AMM account, accumulate its XRP delta from AccountRoot
 *      and its IOU deltas from any RippleState ModifiedNode where the AMM
 *      is one of the two limit-holders.
 *   3. Determine swap direction from the deltas: the side that DECREASED
 *      (negative delta) is what the AMM gave the taker (= takerGets); the
 *      side that INCREASED is what the AMM received (= takerPays).
 *   4. Emit one fill per AMM account touched (cascading paths can swap
 *      against multiple pools).
 *
 * Returns [] when:
 *   - tx didn't touch any AMM accounts
 *   - we couldn't reconstruct both sides of a swap (defensive — skip)
 */
function extractAmmFillsFromTx(tx: RawLedgerTx): Fill[] {
  const meta = tx.meta ?? tx.metaData;
  if (!meta?.AffectedNodes) return [];

  type AmmDelta = {
    /** XRP balance change in drops (negative = AMM gave XRP, positive = AMM received XRP) */
    xrpDelta: bigint;
    /** Map of `${currency}|${issuer}` → IOU balance change as a value string
     *  (positive = AMM received this IOU, negative = AMM gave this IOU). */
    iouDeltas: Map<string, { currency: string; issuer: string; delta: string }>;
  };
  const ammByAddr = new Map<string, AmmDelta>();
  const ensureAmm = (addr: string): AmmDelta => {
    let d = ammByAddr.get(addr);
    if (!d) {
      d = { xrpDelta: 0n, iouDeltas: new Map() };
      ammByAddr.set(addr, d);
    }
    return d;
  };

  /* Pass 1: identify AMM accounts via AccountRoot.AMMID + record XRP delta. */
  for (const node of meta.AffectedNodes) {
    const modified = node.ModifiedNode;
    if (modified?.LedgerEntryType !== "AccountRoot") continue;
    const final = modified.FinalFields as Record<string, unknown> | undefined;
    const prev = modified.PreviousFields as Record<string, unknown> | undefined;
    if (!final?.Account || !final?.AMMID) continue; // not an AMM account
    const addr = final.Account as string;
    const finalBal = parseDropsSafe(String(final.Balance ?? "0"));
    const prevBal = prev?.Balance != null ? parseDropsSafe(String(prev.Balance)) : finalBal;
    ensureAmm(addr).xrpDelta = finalBal - prevBal;
  }

  if (ammByAddr.size === 0) return []; // no AMMs touched

  /* Pass 2: collect IOU deltas from RippleState entries involving each AMM.
   *
   * RippleState.Balance is signed from LowLimit's perspective: a positive
   * balance means LowLimit holds the asset (LowLimit is the "creditor" /
   * holder). A negative balance means HighLimit holds.
   *
   * For the AMM:
   *   - If AMM = LowLimit:  AMM delta = balance delta (positive = AMM gained)
   *   - If AMM = HighLimit: AMM delta = -(balance delta) (sign flips)
   *
   * The "issuer" we record is the OTHER side of the trustline — i.e. the
   * non-AMM side. For an AMM holding an IOU issued by issuer-X, the trustline
   * is between AMM ↔ issuer-X. From the AMM's perspective, the IOU's "issuer"
   * is the other party.
   */
  for (const node of meta.AffectedNodes) {
    const modified = node.ModifiedNode;
    if (modified?.LedgerEntryType !== "RippleState") continue;
    const final = modified.FinalFields as Record<string, unknown> | undefined;
    const prev = modified.PreviousFields as Record<string, unknown> | undefined;
    if (!final) continue;

    const finalBalance = final.Balance as { value?: string; currency?: string } | undefined;
    if (!finalBalance?.value || !finalBalance.currency) continue;
    const prevBalance = (prev?.Balance as { value?: string } | undefined)?.value ?? finalBalance.value;

    const lowLimit = final.LowLimit as { issuer?: string } | undefined;
    const highLimit = final.HighLimit as { issuer?: string } | undefined;
    const lowAddr = lowLimit?.issuer;
    const highAddr = highLimit?.issuer;
    const currency = finalBalance.currency;

    const balDelta = subtractAmounts(finalBalance.value, prevBalance); // final - prev, signed

    if (lowAddr && ammByAddr.has(lowAddr)) {
      // AMM is LowLimit. Balance delta from LowLimit's POV = AMM's holdings change.
      const ammDelta = balDelta;
      const issuer = highAddr ?? "";
      const key = `${currency}|${issuer}`;
      const d = ensureAmm(lowAddr);
      const existing = d.iouDeltas.get(key);
      d.iouDeltas.set(key, {
        currency,
        issuer,
        delta: existing ? addAmounts(existing.delta, ammDelta) : ammDelta,
      });
    } else if (highAddr && ammByAddr.has(highAddr)) {
      // AMM is HighLimit. Balance delta from LowLimit's POV; flip sign for AMM.
      const ammDelta = balDelta.startsWith("-")
        ? balDelta.slice(1)
        : (balDelta === "0" ? "0" : "-" + balDelta);
      const issuer = lowAddr ?? "";
      const key = `${currency}|${issuer}`;
      const d = ensureAmm(highAddr);
      const existing = d.iouDeltas.get(key);
      d.iouDeltas.set(key, {
        currency,
        issuer,
        delta: existing ? addAmounts(existing.delta, ammDelta) : ammDelta,
      });
    }
  }

  /* Pass 3: emit one fill per AMM. The AMM gave one asset (negative delta)
   * and received another (positive delta). Skip if we can't identify both. */
  const fills: Fill[] = [];
  for (const [addr, data] of ammByAddr) {
    /* Build a list of (currency, issuer, delta) across XRP + IOU sides for this AMM. */
    type Side = { currency: string; issuer: string; deltaIsNegative: boolean; absValue: string };
    const sides: Side[] = [];

    if (data.xrpDelta !== 0n) {
      const negative = data.xrpDelta < 0n;
      const abs = (negative ? -data.xrpDelta : data.xrpDelta).toString();
      sides.push({ currency: "XRP", issuer: "", deltaIsNegative: negative, absValue: abs });
    }
    for (const { currency, issuer, delta } of data.iouDeltas.values()) {
      if (delta === "0") continue;
      const negative = delta.startsWith("-");
      const abs = negative ? delta.slice(1) : delta;
      sides.push({ currency, issuer, deltaIsNegative: negative, absValue: abs });
    }

    /* Need exactly one "AMM gave" side and one "AMM received" side to form a fill.
     * Cascading paths through the SAME AMM (rare) would produce cancellations
     * that net out to one effective swap; if not, skip — we don't try to
     * reconstruct a multi-leg fill from one AMM. */
    const gave = sides.filter((s) => s.deltaIsNegative);
    const received = sides.filter((s) => !s.deltaIsNegative);
    if (gave.length !== 1 || received.length !== 1) continue;

    const sold = gave[0]; // taker received this from AMM
    const bought = received[0]; // taker paid this to AMM

    const takerGets =
      sold.currency === "XRP"
        ? sold.absValue
        : { value: sold.absValue, currency: sold.currency, issuer: sold.issuer };
    const takerPays =
      bought.currency === "XRP"
        ? bought.absValue
        : { value: bought.absValue, currency: bought.currency, issuer: bought.issuer };

    fills.push({ takerGets, takerPays, makerAccount: addr });
  }

  return fills;
}

/** Add two XRPL value strings without precision loss. Mirror of subtractAmounts. */
function addAmounts(a: string, b: string): string {
  const da = parseDecimalString(a);
  const db = parseDecimalString(b);
  if (!da || !db) return "0";
  let ma = da.mantissa;
  let mb = db.mantissa;
  let ea = da.exp;
  let eb = db.exp;
  if (ea > eb) {
    ma *= 10n ** BigInt(ea - eb);
    ea = eb;
  } else if (eb > ea) {
    mb *= 10n ** BigInt(eb - ea);
    eb = ea;
  }
  const sum = ma + mb;
  return formatDecimalString(sum, ea);
}

interface NormalizedAmount {
  currency: string;
  issuer: string | null;
  value: string;
}

function normalizeCurrencyAmount(amount: unknown): NormalizedAmount | null {
  if (typeof amount === "string") {
    // XRP in drops
    return { currency: "XRP", issuer: null, value: amount };
  }
  if (typeof amount === "object" && amount !== null) {
    const obj = amount as { value?: string; currency?: string; issuer?: string };
    if (!obj.currency) return null;
    return {
      currency: obj.currency,
      issuer: obj.issuer ?? null,
      value: obj.value ?? "0",
    };
  }
  return null;
}

/**
 * Subtract two XRPL value strings without precision loss.
 *
 * Inputs may be:
 *   - XRP drops: integer string ("123456789") with no decimal/exponent
 *   - IOU value: decimal string with optional `e±N` ("1234.5", "1.23e-5",
 *     "1000000000000000e3"). XRPL IOU values can have up to 16 sig digits,
 *     so JS Number (precise to ~15.95 digits) loses precision for partial
 *     fills, especially in catastrophic-cancellation cases (subtracting two
 *     close values).
 *
 * Approach: parse mantissa + exponent into BigInt, normalize to common scale,
 * BigInt-subtract, format back as a decimal string. Lossless for any value
 * that fits XRPL's 16-sig-digit ceiling. Returns "0" on parse failure.
 */
function subtractAmounts(a: string, b: string): string {
  const da = parseDecimalString(a);
  const db = parseDecimalString(b);
  if (!da || !db) return "0";

  let ma = da.mantissa;
  let mb = db.mantissa;
  let ea = da.exp;
  let eb = db.exp;

  // Normalize to common (lower) exponent so subtraction works on aligned scales
  if (ea > eb) {
    ma *= 10n ** BigInt(ea - eb);
    ea = eb;
  } else if (eb > ea) {
    mb *= 10n ** BigInt(eb - ea);
    eb = ea;
  }

  const diff = ma - mb;
  return formatDecimalString(diff, ea);
}

/** Parse a decimal/scientific string into { mantissa: bigint, exp: number }
 *  such that value = mantissa * 10^exp. Lossless. Returns null on parse error. */
function parseDecimalString(s: string): { mantissa: bigint; exp: number } | null {
  if (!s) return null;
  if (s === "0" || s === "-0" || s === "+0") return { mantissa: 0n, exp: 0 };

  // Split off optional "e±N" exponent suffix
  let exp = 0;
  let body = s;
  const eIdx = s.search(/[eE]/);
  if (eIdx >= 0) {
    const expPart = s.slice(eIdx + 1);
    // Reject empty exponent ("1e", "1.5E"). Number("") === 0 silently passes
    // the isFinite/isInteger checks below, which would treat "1e" as "1" and
    // produce wrong values. XRPL never emits a bare exponent suffix.
    if (!expPart || !/^[-+]?[0-9]+$/.test(expPart)) return null;
    const expNum = Number(expPart);
    if (!Number.isFinite(expNum) || !Number.isInteger(expNum)) return null;
    exp = expNum;
    body = s.slice(0, eIdx);
  }

  // Capture sign
  let sign = 1n;
  if (body.startsWith("-")) {
    sign = -1n;
    body = body.slice(1);
  } else if (body.startsWith("+")) {
    body = body.slice(1);
  }

  // Split mantissa around the decimal point
  const dotIdx = body.indexOf(".");
  let intPart: string;
  let fracPart: string;
  if (dotIdx === -1) {
    intPart = body;
    fracPart = "";
  } else {
    intPart = body.slice(0, dotIdx);
    fracPart = body.slice(dotIdx + 1);
  }

  if (intPart === "" && fracPart === "") return null;

  // Combine digits, treating fracPart as additional integer digits with reduced exp
  const digits = (intPart || "0") + fracPart;
  if (!/^[0-9]+$/.test(digits)) return null;
  let mantissa: bigint;
  try {
    mantissa = BigInt(digits) * sign;
  } catch {
    return null;
  }
  exp -= fracPart.length;
  return { mantissa, exp };
}

/** Format a `mantissa * 10^exp` BigInt back as a decimal string. Strips
 *  trailing zeros / trailing dot; emits "0" for zero values. No scientific
 *  notation in output — XRPL value strings parse fine either way, but plain
 *  decimal is easier on downstream consumers. */
function formatDecimalString(mantissa: bigint, exp: number): string {
  if (mantissa === 0n) return "0";
  const negative = mantissa < 0n;
  let abs = (negative ? -mantissa : mantissa).toString();

  if (exp >= 0) {
    // Append exp zeros to push decimal point right
    if (exp > 0) abs = abs + "0".repeat(exp);
    return (negative ? "-" : "") + abs;
  }

  // exp < 0 → insert decimal point at (len + exp). If insert position is <= 0,
  // pad with leading zeros after "0.".
  const insertAt = abs.length + exp;
  let withDot: string;
  if (insertAt <= 0) {
    withDot = "0." + "0".repeat(-insertAt) + abs;
  } else {
    withDot = abs.slice(0, insertAt) + "." + abs.slice(insertAt);
  }
  // Strip trailing zeros after decimal point, then strip trailing dot
  withDot = withDot.replace(/0+$/, "").replace(/\.$/, "");
  if (withDot === "" || withDot === "-") return "0";
  return (negative ? "-" : "") + withDot;
}
