import Link from "next/link";
import AddressLink from "@/components/shared/AddressLink";
import { formatDate, dropsToXrp, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import { getKnownName } from "@/lib/known-addresses";

/**
 * Tx detail hero. Lifts the "story" of a transaction (parties,
 * amount, when, where, fee) out of the Specification/Outcome 2-col
 * grid and into a prominent summary card at the top — same shape as
 * the account / smart-money / network-stats OverviewCards:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ ● [Result code]              [Date · 2h ago] │  ← header strip
 *   │                                               │
 *   │  100 XRP   Delivered                          │  ← big primary value
 *   │  From  rXX...lLm  [Sologenic]                 │  ← parties
 *   │  To    rYY...kKn                              │
 *   │                                               │
 *   ├─ LEDGER ─ FEE ─ TX INDEX ────────────────────┤  ← 3-col stats strip
 *   └───────────────────────────────────────────────┘
 *
 * The 2-col tech grid below this card now holds purely metadata
 * (Hash, CTID, Signing key, Source Tag, Tx Seq, Flags) — which is
 * naturally balanced because we pulled the asymmetric/story content
 * out of it.
 */

interface TxMeta {
  TransactionResult: string;
  delivered_amount?: unknown;
  [key: string]: unknown;
}

interface TxData {
  TransactionType: string;
  Account: string;
  Destination?: string;
  DestinationTag?: number;
  Amount?: unknown;
  Fee: string;
  date?: number;
  ledger_index?: number;
  inLedger?: number;
  TransactionIndex?: number;
  meta?: TxMeta;
  metaData?: TxMeta;
  [key: string]: unknown;
}

function relativeTime(rippleTime: number): string {
  const ms = (rippleTime + XRPL_EPOCH) * 1000;
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

/**
 * Extract the amount that's most useful to feature in the hero. For
 * a successful payment, prefer the delivered_amount (what actually
 * landed) over the tx.Amount (what was requested) — they can differ
 * for partial payments. For failed txs, fall back to tx.Amount as the
 * attempted value.
 */
function pickPrimaryAmount(
  tx: TxData,
  delivered: unknown,
  isSuccess: boolean,
): { value: string; unit: string; subLabel: string } | null {
  const source =
    isSuccess && delivered != null && delivered !== "unavailable"
      ? delivered
      : tx.Amount;
  if (source == null) return null;

  if (typeof source === "string") {
    return {
      value: dropsToXrp(source),
      unit: "XRP",
      subLabel: isSuccess ? "Delivered" : "Attempted",
    };
  }
  if (source && typeof source === "object") {
    const obj = source as { value?: string; currency?: string };
    return {
      value: obj.value ?? "0",
      unit: obj.currency ?? "",
      subLabel: isSuccess ? "Delivered" : "Attempted",
    };
  }
  return null;
}

export default function HeroCard({ tx }: { tx: TxData }) {
  const meta = tx.meta ?? tx.metaData;
  const result = meta?.TransactionResult ?? "Pending";
  const isSuccess = result === "tesSUCCESS";
  const delivered = meta?.delivered_amount;
  const primary = pickPrimaryAmount(tx, delivered, isSuccess);

  const ledgerIndex = tx.ledger_index ?? tx.inLedger;
  const txIndex =
    typeof tx.TransactionIndex === "number"
      ? tx.TransactionIndex
      : typeof (meta as Record<string, unknown>)?.TransactionIndex === "number"
        ? ((meta as Record<string, unknown>).TransactionIndex as number)
        : null;

  const accountKnown = getKnownName(tx.Account);
  const destKnown = tx.Destination ? getKnownName(tx.Destination) : null;

  return (
    <section
      aria-label="Transaction overview"
      className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card"
    >
      {/* Header strip — status dot + result code on the left,
          date+relative on the right. Mirrors NetworkStatsBar /
          OverviewCard / SmartMoneyOverviewCard header strips. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-elevated px-4 py-1.5">
        <span className="flex shrink-0 items-center gap-1.5 font-display text-label font-medium uppercase tracking-header text-muted">
          <span
            aria-hidden="true"
            className={`inline-block size-1.5 rounded-full ${
              isSuccess ? "bg-success" : "bg-error"
            }`}
          />
          {result}
        </span>
        {tx.date != null && (
          <span className="font-mono text-label text-secondary">
            {formatDate(tx.date)}{" "}
            <span className="text-muted">· {relativeTime(tx.date)}</span>
          </span>
        )}
      </div>

      {/* Body — big primary value + parties */}
      <div className="px-6 py-5">
        {primary && (
          <div className="mb-4">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p className="font-mono text-display font-medium tabular-nums text-brand sm:text-display-lg">
                {primary.value}
              </p>
              <p className="font-mono text-heading font-medium text-muted">
                {primary.unit}
              </p>
              <p
                className={`font-display text-cell font-medium uppercase tracking-header ${
                  isSuccess ? "text-success" : "text-error"
                }`}
              >
                {primary.subLabel}
              </p>
            </div>
          </div>
        )}

        {/* Parties — From / To. Always show From; show To only when
            the tx is party-to-party (Payment / Escrow / Check /
            etc.). For party-less tx types (AccountSet, TrustSet,
            OfferCreate w/ no destination), the From row stands alone. */}
        <div className="space-y-1.5">
          <Party label="From" address={tx.Account} known={accountKnown} />
          {tx.Destination && (
            <Party
              label="To"
              address={tx.Destination}
              known={destKnown}
              destinationTag={tx.DestinationTag}
            />
          )}
        </div>
      </div>

      {/* 3-col stats strip — Ledger | Fee | Tx Index */}
      <div className="grid grid-cols-3 divide-x divide-elevated border-t border-elevated">
        <Stat label="Ledger">
          {ledgerIndex != null ? (
            <Link
              href={`/ledger/${ledgerIndex}`}
              className="text-brand transition-colors hover:text-brand-light"
            >
              {ledgerIndex.toLocaleString()}
            </Link>
          ) : (
            "—"
          )}
        </Stat>
        <Stat label="Fee" sub="XRP">
          {dropsToXrp(tx.Fee)}
        </Stat>
        <Stat label="Tx Index">
          {txIndex != null ? txIndex.toLocaleString() : "—"}
        </Stat>
      </div>
    </section>
  );
}

function Party({
  label,
  address,
  known,
  destinationTag,
}: {
  label: string;
  address: string;
  known: string | null;
  destinationTag?: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="w-10 shrink-0 font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </span>
      <span className="min-w-0 break-all font-mono text-cell text-primary">
        <AddressLink address={address} truncate={false} />
      </span>
      {known && (
        <span className="rounded-tag bg-elevated px-1.5 py-0.5 font-mono text-tag font-medium text-secondary">
          {known}
        </span>
      )}
      {destinationTag != null && (
        <span className="rounded-tag bg-elevated px-1.5 py-0.5 font-mono text-tag font-medium text-muted">
          DT: {destinationTag}
        </span>
      )}
    </div>
  );
}

function Stat({
  label,
  children,
  sub,
}: {
  label: string;
  children: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <span className="block font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </span>
      <p className="mt-1 truncate font-mono text-cell font-medium tabular-nums text-primary">
        {children}
        {sub && <span className="ml-1 font-normal text-muted">{sub}</span>}
      </p>
    </div>
  );
}
