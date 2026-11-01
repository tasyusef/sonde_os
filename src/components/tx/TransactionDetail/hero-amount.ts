/**
 * Which amount the tx hero features, and what to call it.
 *
 * "Delivered" is only true when value actually moved to a destination,
 * which rippled reports as `meta.delivered_amount` (Payment, CheckCash,
 * AccountDelete). Every other type that carries an amount describes
 * intent (an offer price, an escrow, a channel cap), so it gets a label
 * that says what the number is rather than claiming a transfer.
 */

export type HeroTone = "success" | "failed" | "pending";

export interface HeroAmount {
  /** Raw XRPL amount: a drops string or an `{ value, currency }` object. */
  amount: unknown;
  label: string;
  tone: HeroTone;
}

interface AmountRule {
  /** Tx fields to feature, first present wins. */
  fields: readonly string[];
  /** On success, prefer `meta.delivered_amount` over `fields`. */
  delivered?: boolean;
  label: string | ((tx: Record<string, unknown>) => string);
  failedLabel: string;
}

const TF_SELL_NFTOKEN = 0x00000001;
const TF_PARTIAL_PAYMENT = 0x00020000;

const RULES: Record<string, AmountRule> = {
  // DeliverMax is the API v2 name for a Payment's Amount.
  Payment: {
    fields: ["Amount", "DeliverMax"],
    delivered: true,
    label: "Delivered",
    failedLabel: "Not delivered",
  },
  CheckCash: {
    fields: ["Amount", "DeliverMin"],
    delivered: true,
    label: "Cashed",
    failedLabel: "Not cashed",
  },
  // No amount field; the swept balance only exists as delivered_amount.
  AccountDelete: {
    fields: [],
    delivered: true,
    label: "Delivered",
    failedLabel: "Not delivered",
  },
  EscrowCreate: {
    fields: ["Amount"],
    label: "Escrowed",
    failedLabel: "Not escrowed",
  },
  CheckCreate: {
    fields: ["SendMax"],
    label: "Check amount",
    failedLabel: "Check not created",
  },
  PaymentChannelCreate: {
    fields: ["Amount"],
    label: "Channel amount",
    failedLabel: "Channel not opened",
  },
  PaymentChannelFund: {
    fields: ["Amount"],
    label: "Added to channel",
    failedLabel: "Not added",
  },
  NFTokenCreateOffer: {
    fields: ["Amount"],
    label: (tx) =>
      (Number(tx.Flags ?? 0) & TF_SELL_NFTOKEN) !== 0 ? "Sell offer" : "Buy offer",
    failedLabel: "Offer not created",
  },
  // TakerGets is what the offer's owner puts up.
  OfferCreate: {
    fields: ["TakerGets"],
    label: "Offered",
    failedLabel: "Offer not placed",
  },
  AMMCreate: {
    fields: ["Amount"],
    label: "Deposited",
    failedLabel: "Not deposited",
  },
  Clawback: {
    fields: ["Amount"],
    label: "Clawed back",
    failedLabel: "Not clawed back",
  },
};

// Anything else with an Amount (AMMDeposit, PaymentChannelClaim, …) has
// flag-dependent semantics, so stay neutral.
const FALLBACK: AmountRule = {
  fields: ["Amount"],
  label: "Amount",
  failedLabel: "Attempted",
};

/** Missing result = not in a validated ledger yet. */
export function heroTone(result: string | undefined): HeroTone {
  return result === "tesSUCCESS" ? "success" : result ? "failed" : "pending";
}

/** `"unavailable"` is what rippled returns for pre-2014 partial payments. */
function isUsable(amount: unknown): boolean {
  return amount != null && amount !== "unavailable";
}

export function pickHeroAmount(
  tx: Record<string, unknown>,
  meta: { TransactionResult?: string; delivered_amount?: unknown } | undefined,
): HeroAmount | null {
  const rule = RULES[tx.TransactionType as string] ?? FALLBACK;
  const tone = heroTone(meta?.TransactionResult);

  const fieldAmount = rule.fields.map((f) => tx[f]).find(isUsable);

  if (tone === "pending") {
    return fieldAmount != null
      ? { amount: fieldAmount, label: "Pending", tone }
      : null;
  }
  if (tone === "failed") {
    return fieldAmount != null
      ? { amount: fieldAmount, label: rule.failedLabel, tone }
      : null;
  }

  const label =
    typeof rule.label === "function" ? rule.label(tx) : rule.label;

  if (rule.delivered) {
    if (isUsable(meta?.delivered_amount)) {
      return { amount: meta!.delivered_amount, label, tone };
    }
    // Without delivered_amount a partial payment's Amount is only the
    // ceiling; a full payment that succeeded delivered exactly Amount.
    if (
      tx.TransactionType === "Payment" &&
      (Number(tx.Flags ?? 0) & TF_PARTIAL_PAYMENT) !== 0
    ) {
      return fieldAmount != null
        ? { amount: fieldAmount, label: "Requested", tone }
        : null;
    }
  }

  return fieldAmount != null ? { amount: fieldAmount, label, tone } : null;
}
