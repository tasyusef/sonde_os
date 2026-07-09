/**
 * Cost basis extractor — detects token balance increases for tracked accounts
 * by parsing RippleState changes in transaction AffectedNodes. Runs inside
 * the ingestion pipeline (zero additional XRPL requests).
 *
 * For DEX trades (OfferCreate by the tracked account), the actual fill price
 * is extracted. For payments and other sources, cost is $0 (free receipt).
 */

import type { AffectedNode, RawLedgerTx } from "@/types/ingestion";
import { dropsToXrp } from "./xrpl-helpers";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CostBasisEvent {
  address: string;
  currency: string;
  issuer: string;
  /** Quantity of tokens acquired */
  qtyIncrease: string;
  /** XRP cost in drops (0 for free receipts) */
  costDrops: bigint;
  /** USD cost at time of acquisition */
  costUsd: string;
}

export interface DisposalEvent {
  address: string;
  currency: string;
  issuer: string;
  /** Quantity of tokens sold/disposed */
  qtySold: string;
  /** XRP proceeds in drops (0 for free transfers) */
  proceedsDrops: bigint;
  /** USD proceeds at time of sale */
  proceedsUsd: string;
  txHash: string;
  ledgerIndex: number;
  timestamp: Date;
}

/* ------------------------------------------------------------------ */
/*  RippleState balance helpers                                        */
/* ------------------------------------------------------------------ */

interface BalanceField {
  value: string;
  currency: string;
}

/**
 * Extract the balance field from a RippleState node's fields.
 * Balance is from the low account's perspective:
 *   positive = low account holds tokens from high account
 *   negative = high account holds tokens from low account
 */
function getBalance(fields: Record<string, unknown> | undefined): BalanceField | null {
  if (!fields) return null;
  const bal = fields.Balance as { value?: string; currency?: string } | undefined;
  if (!bal?.value || !bal?.currency) return null;
  return { value: bal.value, currency: bal.currency };
}

function getLimitAccount(
  fields: Record<string, unknown> | undefined,
  side: "HighLimit" | "LowLimit",
): string | null {
  if (!fields) return null;
  const limit = fields[side] as { issuer?: string } | undefined;
  return limit?.issuer ?? null;
}

/* ------------------------------------------------------------------ */
/*  Fill price extraction for OfferCreate trades                       */
/* ------------------------------------------------------------------ */

interface NormalizedAmt {
  currency: string;
  issuer: string | null;
  value: string;
}

function normalizeAmount(amount: unknown): NormalizedAmt | null {
  if (typeof amount === "string") {
    return { currency: "XRP", issuer: null, value: amount };
  }
  if (typeof amount === "object" && amount !== null) {
    const obj = amount as { value?: string; currency?: string; issuer?: string };
    if (!obj.currency) return null;
    return { currency: obj.currency, issuer: obj.issuer ?? null, value: obj.value ?? "0" };
  }
  return null;
}

/**
 * For an OfferCreate transaction by a tracked account, extract the total XRP
 * cost paid for a specific token (currency:issuer) across all fills.
 *
 * Returns total XRP drops spent to acquire the given token, or null if the
 * tracked account didn't trade that specific token in this transaction.
 */
function extractXrpCostForToken(
  nodes: AffectedNode[],
  txAccount: string,
  targetCurrency: string,
  targetIssuer: string,
): bigint | null {
  let totalXrpDrops = 0n;
  let found = false;

  for (const node of nodes) {
    const deleted = node.DeletedNode;
    const modified = node.ModifiedNode;

    let takerGetsRaw: unknown = null;
    let takerPaysRaw: unknown = null;

    if (deleted?.LedgerEntryType === "Offer") {
      const prev = deleted.PreviousFields as Record<string, unknown> | undefined;
      const final = deleted.FinalFields as Record<string, unknown> | undefined;
      if (!final) continue;
      // Skip the sender's own cancelled offers
      if ((final.Account as string) === txAccount) continue;

      if (prev?.TakerGets && final.TakerGets) {
        // Consumed then deleted: compute diff (same as ModifiedNode)
        const prevGets = normalizeAmount(prev.TakerGets);
        const finalGets = normalizeAmount(final.TakerGets);
        const prevPays = normalizeAmount(prev.TakerPays);
        const finalPays = normalizeAmount(final.TakerPays);
        if (!prevGets || !finalGets || !prevPays || !finalPays) continue;

        const getsValue = amountDiff(prevGets, finalGets);
        const paysValue = amountDiff(prevPays, finalPays);

        takerGetsRaw =
          prevGets.currency === "XRP"
            ? getsValue
            : { value: getsValue, currency: prevGets.currency, issuer: prevGets.issuer };
        takerPaysRaw =
          prevPays.currency === "XRP"
            ? paysValue
            : { value: paysValue, currency: prevPays.currency, issuer: prevPays.issuer };
      } else {
        // No PreviousFields: fully consumed in one shot (FinalFields has zeroed amounts)
        takerGetsRaw = prev?.TakerGets ?? final.TakerGets;
        takerPaysRaw = prev?.TakerPays ?? final.TakerPays;
      }
    } else if (modified?.LedgerEntryType === "Offer") {
      const prev = modified.PreviousFields as Record<string, unknown> | undefined;
      const final = modified.FinalFields as Record<string, unknown> | undefined;
      if (!prev?.TakerGets || !final?.TakerGets) continue;
      if ((final.Account as string) === txAccount) continue;

      // Partially consumed: compute difference
      const prevGets = normalizeAmount(prev.TakerGets);
      const finalGets = normalizeAmount(final.TakerGets);
      const prevPays = normalizeAmount(prev.TakerPays);
      const finalPays = normalizeAmount(final.TakerPays);
      if (!prevGets || !finalGets || !prevPays || !finalPays) continue;

      const getsValue = amountDiff(prevGets, finalGets);
      const paysValue = amountDiff(prevPays, finalPays);

      takerGetsRaw =
        prevGets.currency === "XRP"
          ? getsValue
          : { value: getsValue, currency: prevGets.currency, issuer: prevGets.issuer };
      takerPaysRaw =
        prevPays.currency === "XRP"
          ? paysValue
          : { value: paysValue, currency: prevPays.currency, issuer: prevPays.issuer };
    } else {
      continue;
    }

    const gets = normalizeAmount(takerGetsRaw);
    const pays = normalizeAmount(takerPaysRaw);
    if (!gets || !pays) continue;

    // The OfferCreate sender (tracked account) is the "taker":
    //   - Taker GETS what the maker offered (takerGets)
    //   - Taker PAYS what the maker wanted (takerPays)
    // So if the tracked account acquired the target token:
    //   the target token is in takerPays (what the maker wanted = what the taker sends??)
    //
    // Wait — XRPL semantics: the consumed offer's TakerGets is what the offer
    // owner (maker) is selling. The OfferCreate sender (taker) RECEIVES takerGets
    // and PAYS takerPays.
    //
    // So: taker receives takerGets, taker pays takerPays.
    // If taker acquired the target token → target is in takerGets.
    // If taker paid XRP → XRP is in takerPays.

    // Case: taker got tokens (takerGets = token), paid XRP (takerPays = XRP)
    if (
      gets.currency === targetCurrency &&
      gets.issuer === targetIssuer &&
      pays.currency === "XRP"
    ) {
      // takerPays is XRP in drops
      const dropsStr = pays.value;
      // XRP amounts are integer drops — parse directly as BigInt to avoid
      // float precision loss above Number.MAX_SAFE_INTEGER.
      const drops = parseBigIntSafe(dropsStr);
      if (drops > 0n) {
        totalXrpDrops += drops;
        found = true;
      }
    }
  }

  return found ? totalXrpDrops : null;
}

/** Parse a numeric string to BigInt, handling potential decimal strings safely. */
function parseBigIntSafe(s: string): bigint {
  // Integer strings (e.g. "12345678") → BigInt directly
  if (/^-?\d+$/.test(s)) return BigInt(s);
  // Decimal strings (e.g. partial fill diffs) → round to nearest integer
  const n = Number(s);
  return Number.isFinite(n) ? BigInt(Math.round(n)) : 0n;
}

/** Compute prev - final for an amount field. Uses BigInt for XRP drops (can exceed MAX_SAFE_INTEGER). */
function amountDiff(prev: NormalizedAmt, final: NormalizedAmt): string {
  if (prev.currency === "XRP") {
    return (parseBigIntSafe(prev.value) - parseBigIntSafe(final.value)).toString();
  }
  return (parseFloat(prev.value) - parseFloat(final.value)).toString();
}

/* ------------------------------------------------------------------ */
/*  Main extractor                                                     */
/* ------------------------------------------------------------------ */

/**
 * Extract cost basis events from a successful transaction.
 * Scans AffectedNodes for RippleState balance increases on tracked accounts.
 */
export function extractCostBasisEvents(
  rawTx: RawLedgerTx,
  nodes: AffectedNode[],
  trackedAccounts: Set<string>,
  xrpPriceUsd: number,
): CostBasisEvent[] {
  const events: CostBasisEvent[] = [];

  for (const node of nodes) {
    // Handle ModifiedNode (existing trust line, balance changed)
    const modified = node.ModifiedNode;
    if (modified?.LedgerEntryType === "RippleState") {
      const final = modified.FinalFields as Record<string, unknown> | undefined;
      const prev = modified.PreviousFields as Record<string, unknown> | undefined;
      if (!final || !prev) continue;

      const prevBal = getBalance(prev);
      const finalBal = getBalance(final);
      // PreviousFields.Balance may be absent if balance didn't change
      if (!prevBal || !finalBal) continue;

      const lowAccount = getLimitAccount(final, "LowLimit");
      const highAccount = getLimitAccount(final, "HighLimit");
      if (!lowAccount || !highAccount) continue;

      const delta = parseFloat(finalBal.value) - parseFloat(prevBal.value);
      if (delta === 0) continue;

      // Positive delta = low account gained, high account lost
      // Negative delta = high account gained, low account lost
      const gainerAccount = delta > 0 ? lowAccount : highAccount;
      const gainerIssuer = delta > 0 ? highAccount : lowAccount;
      const qtyIncrease = Math.abs(delta);

      if (!trackedAccounts.has(gainerAccount)) continue;
      if (qtyIncrease <= 0) continue;

      const currency = finalBal.currency;
      const evt = buildEvent(
        rawTx, nodes, gainerAccount, currency, gainerIssuer,
        qtyIncrease, xrpPriceUsd,
      );
      if (evt) events.push(evt);
      continue;
    }

    // Handle CreatedNode (new trust line created with initial balance)
    const created = node.CreatedNode;
    if (created?.LedgerEntryType === "RippleState") {
      const newFields = created.NewFields as Record<string, unknown> | undefined;
      if (!newFields) continue;

      const bal = getBalance(newFields);
      if (!bal) continue;

      const lowAccount = getLimitAccount(newFields, "LowLimit");
      const highAccount = getLimitAccount(newFields, "HighLimit");
      if (!lowAccount || !highAccount) continue;

      const balValue = parseFloat(bal.value);
      if (balValue === 0) continue;

      // Same sign logic: positive = low account holds
      const gainerAccount = balValue > 0 ? lowAccount : highAccount;
      const gainerIssuer = balValue > 0 ? highAccount : lowAccount;
      const qtyIncrease = Math.abs(balValue);

      if (!trackedAccounts.has(gainerAccount)) continue;

      const currency = bal.currency;
      const evt = buildEvent(
        rawTx, nodes, gainerAccount, currency, gainerIssuer,
        qtyIncrease, xrpPriceUsd,
      );
      if (evt) events.push(evt);
    }
  }

  return events;
}

/**
 * Build a CostBasisEvent, determining cost from the transaction context.
 */
function buildEvent(
  rawTx: RawLedgerTx,
  nodes: AffectedNode[],
  address: string,
  currency: string,
  issuer: string,
  qtyIncrease: number,
  xrpPriceUsd: number,
): CostBasisEvent | null {
  if (qtyIncrease <= 0) return null;

  let costDrops = 0n;
  let costUsd = 0;

  // If the tracked account submitted an OfferCreate, extract explicit fill price
  if (rawTx.TransactionType === "OfferCreate" && rawTx.Account === address) {
    const xrpCost = extractXrpCostForToken(nodes, address, currency, issuer);
    if (xrpCost != null && xrpCost > 0n) {
      costDrops = xrpCost;
      costUsd = parseFloat(dropsToXrp(xrpCost.toString())) * xrpPriceUsd;
    }
    // If xrpCost is null, it was a token-to-token trade — v1 records as zero cost
  }
  // All other tx types (Payment, AMM, etc.): cost = 0 (free receipt)

  return {
    address,
    currency,
    issuer,
    qtyIncrease: qtyIncrease.toString(),
    costDrops,
    costUsd: costUsd.toFixed(8),
  };
}

/* ------------------------------------------------------------------ */
/*  Disposal (sale) extraction                                         */
/* ------------------------------------------------------------------ */

/**
 * For an OfferCreate transaction by a tracked account that SOLD tokens,
 * extract the total XRP received for a specific token across all fills.
 *
 * This is the reverse of extractXrpCostForToken: instead of finding XRP paid
 * for tokens, it finds XRP received from selling tokens.
 */
function extractXrpProceedsForToken(
  nodes: AffectedNode[],
  txAccount: string,
  targetCurrency: string,
  targetIssuer: string,
): bigint | null {
  let totalXrpDrops = 0n;
  let found = false;

  for (const node of nodes) {
    const deleted = node.DeletedNode;
    const modified = node.ModifiedNode;

    let takerGetsRaw: unknown = null;
    let takerPaysRaw: unknown = null;

    if (deleted?.LedgerEntryType === "Offer") {
      const prev = deleted.PreviousFields as Record<string, unknown> | undefined;
      const final = deleted.FinalFields as Record<string, unknown> | undefined;
      if (!final) continue;
      if ((final.Account as string) === txAccount) continue;

      if (prev?.TakerGets && final.TakerGets) {
        // Consumed then deleted: compute diff (same as ModifiedNode)
        const prevGets = normalizeAmount(prev.TakerGets);
        const finalGets = normalizeAmount(final.TakerGets);
        const prevPays = normalizeAmount(prev.TakerPays);
        const finalPays = normalizeAmount(final.TakerPays);
        if (!prevGets || !finalGets || !prevPays || !finalPays) continue;

        const getsValue = amountDiff(prevGets, finalGets);
        const paysValue = amountDiff(prevPays, finalPays);

        takerGetsRaw =
          prevGets.currency === "XRP"
            ? getsValue
            : { value: getsValue, currency: prevGets.currency, issuer: prevGets.issuer };
        takerPaysRaw =
          prevPays.currency === "XRP"
            ? paysValue
            : { value: paysValue, currency: prevPays.currency, issuer: prevPays.issuer };
      } else {
        // No PreviousFields: fully consumed in one shot (FinalFields has zeroed amounts)
        takerGetsRaw = prev?.TakerGets ?? final.TakerGets;
        takerPaysRaw = prev?.TakerPays ?? final.TakerPays;
      }
    } else if (modified?.LedgerEntryType === "Offer") {
      const prev = modified.PreviousFields as Record<string, unknown> | undefined;
      const final = modified.FinalFields as Record<string, unknown> | undefined;
      if (!prev?.TakerGets || !final?.TakerGets) continue;
      if ((final.Account as string) === txAccount) continue;

      const prevGets = normalizeAmount(prev.TakerGets);
      const finalGets = normalizeAmount(final.TakerGets);
      const prevPays = normalizeAmount(prev.TakerPays);
      const finalPays = normalizeAmount(final.TakerPays);
      if (!prevGets || !finalGets || !prevPays || !finalPays) continue;

      const getsValue = amountDiff(prevGets, finalGets);
      const paysValue = amountDiff(prevPays, finalPays);

      takerGetsRaw =
        prevGets.currency === "XRP"
          ? getsValue
          : { value: getsValue, currency: prevGets.currency, issuer: prevGets.issuer };
      takerPaysRaw =
        prevPays.currency === "XRP"
          ? paysValue
          : { value: paysValue, currency: prevPays.currency, issuer: prevPays.issuer };
    } else {
      continue;
    }

    const gets = normalizeAmount(takerGetsRaw);
    const pays = normalizeAmount(takerPaysRaw);
    if (!gets || !pays) continue;

    // Taker SENDS takerPays, RECEIVES takerGets.
    // If taker sold the target token → target is in takerPays (what the taker sent).
    // If taker received XRP → XRP is in takerGets.
    if (
      pays.currency === targetCurrency &&
      pays.issuer === targetIssuer &&
      gets.currency === "XRP"
    ) {
      const dropsStr = gets.value;
      const drops = parseBigIntSafe(dropsStr);
      if (drops > 0n) {
        totalXrpDrops += drops;
        found = true;
      }
    }
  }

  return found ? totalXrpDrops : null;
}

/* ------------------------------------------------------------------ */
/*  XRP cost basis — Offer-node approach (no AccountRoot noise)        */
/* ------------------------------------------------------------------ */

/**
 * Shared helper: iterate consumed Offer nodes in an OfferCreate tx and
 * extract fills where one side is XRP. Returns { xrpDrops, tokenValueUsd }
 * for each direction.
 *
 * "xrpAcquired" = fills where taker received XRP (takerGets = XRP)
 * "xrpDisposed" = fills where taker paid XRP (takerPays = XRP)
 */
function extractXrpOfferFills(
  nodes: AffectedNode[],
  txAccount: string,
  xrpPriceUsd: number,
): { acquired: { xrpDrops: bigint; costUsd: number }; disposed: { xrpDrops: bigint; proceedsUsd: number } } {
  let acquiredDrops = 0n;
  let acquiredCostUsd = 0; // USD value of tokens sold to get XRP
  let disposedDrops = 0n;
  let disposedProceedsUsd = 0; // USD value of tokens received for XRP

  for (const node of nodes) {
    const deleted = node.DeletedNode;
    const modified = node.ModifiedNode;

    let takerGetsRaw: unknown = null;
    let takerPaysRaw: unknown = null;

    if (deleted?.LedgerEntryType === "Offer") {
      const prev = deleted.PreviousFields as Record<string, unknown> | undefined;
      const final = deleted.FinalFields as Record<string, unknown> | undefined;
      if (!final) continue;
      if ((final.Account as string) === txAccount) continue;

      if (prev?.TakerGets && final.TakerGets) {
        const prevGets = normalizeAmount(prev.TakerGets);
        const finalGets = normalizeAmount(final.TakerGets);
        const prevPays = normalizeAmount(prev.TakerPays);
        const finalPays = normalizeAmount(final.TakerPays);
        if (!prevGets || !finalGets || !prevPays || !finalPays) continue;

        const getsValue = amountDiff(prevGets, finalGets);
        const paysValue = amountDiff(prevPays, finalPays);

        takerGetsRaw =
          prevGets.currency === "XRP"
            ? getsValue
            : { value: getsValue, currency: prevGets.currency, issuer: prevGets.issuer };
        takerPaysRaw =
          prevPays.currency === "XRP"
            ? paysValue
            : { value: paysValue, currency: prevPays.currency, issuer: prevPays.issuer };
      } else {
        takerGetsRaw = prev?.TakerGets ?? final.TakerGets;
        takerPaysRaw = prev?.TakerPays ?? final.TakerPays;
      }
    } else if (modified?.LedgerEntryType === "Offer") {
      const prev = modified.PreviousFields as Record<string, unknown> | undefined;
      const final = modified.FinalFields as Record<string, unknown> | undefined;
      if (!prev?.TakerGets || !final?.TakerGets) continue;
      if ((final.Account as string) === txAccount) continue;

      const prevGets = normalizeAmount(prev.TakerGets);
      const finalGets = normalizeAmount(final.TakerGets);
      const prevPays = normalizeAmount(prev.TakerPays);
      const finalPays = normalizeAmount(final.TakerPays);
      if (!prevGets || !finalGets || !prevPays || !finalPays) continue;

      const getsValue = amountDiff(prevGets, finalGets);
      const paysValue = amountDiff(prevPays, finalPays);

      takerGetsRaw =
        prevGets.currency === "XRP"
          ? getsValue
          : { value: getsValue, currency: prevGets.currency, issuer: prevGets.issuer };
      takerPaysRaw =
        prevPays.currency === "XRP"
          ? paysValue
          : { value: paysValue, currency: prevPays.currency, issuer: prevPays.issuer };
    } else {
      continue;
    }

    const gets = normalizeAmount(takerGetsRaw);
    const pays = normalizeAmount(takerPaysRaw);
    if (!gets || !pays) continue;

    // Taker receives takerGets, pays takerPays.
    // Case 1: taker receives XRP (gets = XRP, pays = token) → XRP acquired
    if (gets.currency === "XRP" && pays.currency !== "XRP") {
      const drops = parseBigIntSafe(gets.value);
      if (drops > 0n) {
        acquiredDrops += drops;
        // Cost = USD value of tokens given up to get this XRP
        // For now, derive from XRP value (since we know the XRP price)
        acquiredCostUsd += parseFloat(dropsToXrp(drops.toString())) * xrpPriceUsd;
      }
    }
    // Case 2: taker pays XRP (pays = XRP, gets = token) → XRP disposed
    if (pays.currency === "XRP" && gets.currency !== "XRP") {
      const drops = parseBigIntSafe(pays.value);
      if (drops > 0n) {
        disposedDrops += drops;
        // Proceeds = USD value of tokens received for this XRP
        disposedProceedsUsd += parseFloat(dropsToXrp(drops.toString())) * xrpPriceUsd;
      }
    }
  }

  return {
    acquired: { xrpDrops: acquiredDrops, costUsd: acquiredCostUsd },
    disposed: { xrpDrops: disposedDrops, proceedsUsd: disposedProceedsUsd },
  };
}

/** XRP sentinel values for reuse in existing (address, currency, issuer) tables. */
export const XRP_COST_BASIS_CURRENCY = "XRP";
export const XRP_COST_BASIS_ISSUER = "native";

/**
 * Extract XRP cost basis events from an OfferCreate by a tracked account.
 * Reads Offer node fills (same as token extractor) — no AccountRoot noise.
 *
 * Only OfferCreate trades produce XRP cost basis events. Payments, escrows,
 * AMM deposits, fees, and reserves are excluded (they don't appear in Offer nodes).
 */
export function extractXrpCostBasisEvents(
  rawTx: RawLedgerTx,
  nodes: AffectedNode[],
  trackedAccounts: Set<string>,
  xrpPriceUsd: number,
): CostBasisEvent[] {
  if (rawTx.TransactionType !== "OfferCreate") return [];
  const account = rawTx.Account as string;
  if (!trackedAccounts.has(account)) return [];

  const fills = extractXrpOfferFills(nodes, account, xrpPriceUsd);
  if (fills.acquired.xrpDrops <= 0n) return [];

  // XRP acquired via DEX: cost = USD value at time of trade
  return [{
    address: account,
    currency: XRP_COST_BASIS_CURRENCY,
    issuer: XRP_COST_BASIS_ISSUER,
    qtyIncrease: dropsToXrp(fills.acquired.xrpDrops.toString()),
    costDrops: 0n, // XRP cost-in-drops is meaningless for XRP itself
    costUsd: fills.acquired.costUsd.toFixed(8),
  }];
}

/**
 * Extract XRP disposal events from an OfferCreate by a tracked account.
 * Returns events when the taker paid XRP and received tokens.
 */
export function extractXrpDisposalEvents(
  rawTx: RawLedgerTx,
  nodes: AffectedNode[],
  trackedAccounts: Set<string>,
  xrpPriceUsd: number,
  ledgerIndex: number,
  closeTime: Date,
): DisposalEvent[] {
  if (rawTx.TransactionType !== "OfferCreate") return [];
  const account = rawTx.Account as string;
  if (!trackedAccounts.has(account)) return [];

  const fills = extractXrpOfferFills(nodes, account, xrpPriceUsd);
  if (fills.disposed.xrpDrops <= 0n) return [];

  const txHash = (rawTx as unknown as Record<string, unknown>).hash as string ?? "";

  return [{
    address: account,
    currency: XRP_COST_BASIS_CURRENCY,
    issuer: XRP_COST_BASIS_ISSUER,
    qtySold: dropsToXrp(fills.disposed.xrpDrops.toString()),
    proceedsDrops: 0n, // XRP proceeds-in-drops is meaningless for XRP itself
    proceedsUsd: fills.disposed.proceedsUsd.toFixed(8),
    txHash,
    ledgerIndex,
    timestamp: closeTime,
  }];
}

/**
 * Extract disposal (sale) events from a successful transaction.
 * Scans AffectedNodes for RippleState balance DECREASES on tracked accounts.
 * Only records proceeds for OfferCreate trades; other tx types record $0.
 */
export function extractDisposalEvents(
  rawTx: RawLedgerTx,
  nodes: AffectedNode[],
  trackedAccounts: Set<string>,
  xrpPriceUsd: number,
  ledgerIndex: number,
  closeTime: Date,
): DisposalEvent[] {
  const events: DisposalEvent[] = [];
  const txHash = (rawTx as unknown as Record<string, unknown>).hash as string ?? "";

  for (const node of nodes) {
    let prevBal: BalanceField | null = null;
    let finalBal: BalanceField | null = null;
    let lowAccount: string | null = null;
    let highAccount: string | null = null;

    // Handle ModifiedNode (existing trust line, balance changed)
    const modified = node.ModifiedNode;
    if (modified?.LedgerEntryType === "RippleState") {
      const final = modified.FinalFields as Record<string, unknown> | undefined;
      const prev = modified.PreviousFields as Record<string, unknown> | undefined;
      if (!final || !prev) continue;

      prevBal = getBalance(prev);
      finalBal = getBalance(final);
      lowAccount = getLimitAccount(final, "LowLimit");
      highAccount = getLimitAccount(final, "HighLimit");
    }

    // Handle DeletedNode (trust line fully consumed — balance went to zero)
    const deleted = node.DeletedNode;
    if (!modified && deleted?.LedgerEntryType === "RippleState") {
      const final = deleted.FinalFields as Record<string, unknown> | undefined;
      const prev = deleted.PreviousFields as Record<string, unknown> | undefined;
      if (!final) continue;

      // FinalFields balance is zero (line deleted), PreviousFields has the old balance
      prevBal = getBalance(prev) ?? getBalance(final);
      finalBal = { value: "0", currency: prevBal?.currency ?? "" };
      lowAccount = getLimitAccount(final, "LowLimit");
      highAccount = getLimitAccount(final, "HighLimit");
    }

    if (!prevBal || !finalBal || !lowAccount || !highAccount) continue;

    const delta = parseFloat(finalBal.value) - parseFloat(prevBal.value);
    if (delta === 0) continue;

    // Positive delta → low account gained, high account LOST
    // Negative delta → high account gained, low account LOST
    const loserAccount = delta > 0 ? highAccount : lowAccount;
    const loserIssuer = delta > 0 ? lowAccount : highAccount;
    const qtySold = Math.abs(delta);

    if (!trackedAccounts.has(loserAccount)) continue;
    if (qtySold <= 0) continue;

    const currency = finalBal.currency || prevBal.currency;

    // Determine sale proceeds
    let proceedsDrops = 0n;
    let proceedsUsd = 0;

    if (rawTx.TransactionType === "OfferCreate" && rawTx.Account === loserAccount) {
      const xrpProceeds = extractXrpProceedsForToken(nodes, loserAccount, currency, loserIssuer);
      if (xrpProceeds != null && xrpProceeds > 0n) {
        proceedsDrops = xrpProceeds;
        proceedsUsd = parseFloat(dropsToXrp(xrpProceeds.toString())) * xrpPriceUsd;
      }
    }
    // Other tx types (Payment out, AMM withdrawal, etc.): proceeds = $0

    events.push({
      address: loserAccount,
      currency,
      issuer: loserIssuer,
      qtySold: qtySold.toString(),
      proceedsDrops,
      proceedsUsd: proceedsUsd.toFixed(8),
      txHash,
      ledgerIndex,
      timestamp: closeTime,
    });
  }

  return events;
}
