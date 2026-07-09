/**
 * Trustline state extractor — pulls RippleState changes out of every
 * trustline-affecting tx and emits rows for the `trustlines` CH table.
 *
 * Each on-chain RippleState entry yields TWO rows — one keyed on each
 * side's account, with balance/limit/flags flipped to that side's
 * perspective. This denormalization makes "all trustlines for X" a
 * partition prune + range scan instead of an OR-clause across two
 * columns that doesn't index well.
 *
 * Tx types that touch RippleState entries:
 *   - TrustSet              — explicit trustline create/modify/delete
 *   - Payment               — IOU delivery updates RippleState balance
 *   - AMMDeposit/Withdraw   — AMM ops change LP-token RippleStates
 *   - AMMCreate/Delete      — AMM lifecycle
 *   - OfferCreate / Payment — cross-currency rippling updates RippleStates
 *   - AccountDelete         — burns all trustlines of the deleted account
 *
 * Rather than enumerate tx types, we walk every tx's `meta.AffectedNodes`
 * for RippleState entries. Any tx that touches one is in scope.
 *
 * Balance sign convention from the row's perspective:
 *   - Positive: counterparty owes account (account holds tokens)
 *   - Negative: account owes counterparty (mostly AMM LP holders)
 *
 * On-ledger Balance.value is signed by the LowLimit-side perspective by
 * convention. We flip the sign when emitting the HighLimit-side row.
 *
 * No `server-only` import — the backfill script imports this via tsx,
 * outside Next.js. The extractor is a pure function with no I/O.
 */

import type {
  RawLedgerTx,
  AffectedNode,
  CurrencyAmount,
} from "@/types/ingestion";

const XRPL_EPOCH_OFFSET_S = 946_684_800;

/** lsfHighReserve / lsfLowReserve and the perspective-paired flag bits.
 *  We don't decode these into per-side fields here — the raw flags are
 *  stored as-is on each row, so consumers can inspect them per
 *  perspective by checking the appropriate bit. */
// (intentionally not exported — documenting intent only)

export interface TrustlineRow extends Record<string, unknown> {
  account: string;
  counterparty: string;
  currency: string;
  balance_value: string;
  account_limit: string;
  counterparty_limit: string;
  flags: number;
  is_lp: number;
  is_burned: number;
  ledger_index: number;
  last_updated: string;
}

/** Convert XRPL `date` (seconds since 2000-01-01 UTC) to CH DateTime. */
function xrplDateToCHDateTime(xrplDate: number): string {
  const d = new Date((xrplDate + XRPL_EPOCH_OFFSET_S) * 1000);
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/** AMM LP tokens use a 40-char hex currency code starting with "03"
 *  per the AMM amendment spec. Cheap, deterministic — matches the
 *  partitionTrustLines logic in `@/lib/amm-helpers`. */
function isLpCurrency(currency: string): boolean {
  return currency.length === 40 && currency.startsWith("03");
}

/** Ledger amount "1.5e-3" → "0.0015". JSON.parse of XRPL meta values
 *  preserves their string form which sometimes uses scientific notation;
 *  CH's String storage works fine, but consumers expecting decimal
 *  notation should normalize.  For now we just pass the string through —
 *  CH stores it as-is. */
function normalizeIouValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "0";
}

interface RippleStateFields {
  Balance?: CurrencyAmount;
  HighLimit?: CurrencyAmount;
  LowLimit?: CurrencyAmount;
  Flags?: number;
}

/** Pull a RippleState's relevant fields from a node — handles Created
 *  (NewFields), Modified (FinalFields), and Deleted (FinalFields). */
function extractRippleStateFields(
  node: AffectedNode,
): { fields: RippleStateFields; deleted: boolean } | null {
  if (node.CreatedNode?.LedgerEntryType === "RippleState") {
    return {
      fields: (node.CreatedNode.NewFields ?? {}) as RippleStateFields,
      deleted: false,
    };
  }
  if (node.ModifiedNode?.LedgerEntryType === "RippleState") {
    // FinalFields holds the post-tx state. PreviousFields tracks deltas
    // which we don't need — we just want the latest state.
    const final = node.ModifiedNode.FinalFields;
    if (!final) return null;
    return { fields: final as RippleStateFields, deleted: false };
  }
  if (node.DeletedNode?.LedgerEntryType === "RippleState") {
    const final = node.DeletedNode.FinalFields;
    if (!final) return null;
    return { fields: final as RippleStateFields, deleted: true };
  }
  return null;
}

/**
 * Generate the two trustline rows for a single RippleState event.
 *   - Row A: keyed on LowLimit.issuer
 *   - Row B: keyed on HighLimit.issuer
 *
 * Balance.value is conventionally signed from the LowLimit side. So:
 *   - LowLimit row's balance_value = Balance.value (as-is)
 *   - HighLimit row's balance_value = -Balance.value (sign flipped)
 *
 * Flags are stored raw — perspective-specific bits (lsfNoRipple/Freeze
 * have High/Low variants) can be decoded by consumers when needed.
 */
function rowsFromRippleState(
  fields: RippleStateFields,
  deleted: boolean,
  ledgerIndex: number,
  closeTimestamp: string,
): TrustlineRow[] {
  const balance = fields.Balance;
  const highLimit = fields.HighLimit;
  const lowLimit = fields.LowLimit;
  if (!balance || !highLimit || !lowLimit) return [];
  if (!balance.issuer || !highLimit.issuer || !lowLimit.issuer) return [];

  const currency = balance.currency;
  const balanceValue = normalizeIouValue(balance.value);
  const highLimitValue = normalizeIouValue(highLimit.value);
  const lowLimitValue = normalizeIouValue(lowLimit.value);
  const flags = Number(fields.Flags ?? 0);
  const lp = isLpCurrency(currency) ? 1 : 0;
  const burned = deleted ? 1 : 0;

  const lowRow: TrustlineRow = {
    account: lowLimit.issuer,
    counterparty: highLimit.issuer,
    currency,
    balance_value: balanceValue,
    account_limit: lowLimitValue,
    counterparty_limit: highLimitValue,
    flags,
    is_lp: lp,
    is_burned: burned,
    ledger_index: ledgerIndex,
    last_updated: closeTimestamp,
  };

  // High-side balance is the additive inverse. Strip a leading minus to
  // flip; prepend one if not already negative. Special-case "0".
  const highBalance =
    balanceValue === "0" || balanceValue === "0.0"
      ? "0"
      : balanceValue.startsWith("-")
        ? balanceValue.slice(1)
        : `-${balanceValue}`;

  const highRow: TrustlineRow = {
    account: highLimit.issuer,
    counterparty: lowLimit.issuer,
    currency,
    balance_value: highBalance,
    account_limit: highLimitValue,
    counterparty_limit: lowLimitValue,
    flags,
    is_lp: lp,
    is_burned: burned,
    ledger_index: ledgerIndex,
    last_updated: closeTimestamp,
  };

  return [lowRow, highRow];
}

/**
 * Extract trustline state events from a single transaction. Returns
 * empty for non-success or txs that don't touch RippleState.
 */
export function extractTrustlineEvents(tx: RawLedgerTx): TrustlineRow[] {
  const meta = tx.meta ?? tx.metaData;
  if (!meta || meta.TransactionResult !== "tesSUCCESS") return [];
  if (!tx.ledger_index || !tx.date) return [];

  const ledgerIndex = tx.ledger_index;
  const closeTimestamp = xrplDateToCHDateTime(tx.date);
  const out: TrustlineRow[] = [];

  for (const node of meta.AffectedNodes ?? []) {
    const extracted = extractRippleStateFields(node);
    if (!extracted) continue;
    out.push(
      ...rowsFromRippleState(
        extracted.fields,
        extracted.deleted,
        ledgerIndex,
        closeTimestamp,
      ),
    );
  }

  return out;
}
