import AddressLink from "@/components/shared/AddressLink";
import CopyButton from "@/components/shared/CopyButton";
import Decode from "@/components/shared/Decode";
import { getKnownName } from "@/lib/known-addresses";
import { decodeCurrency, dropsToXrp } from "@/lib/xrpl-helpers";
import { heroTone, pickHeroAmount, type HeroTone } from "./hero-amount";
import type { TxData } from "./types";

export const TONE_TEXT: Record<HeroTone, string> = {
  success: "text-success",
  failed: "text-error",
  pending: "text-muted",
};

const TONE_LABEL: Record<HeroTone, string> = {
  success: "Success",
  failed: "Failed",
  pending: "Pending",
};

/** Split a raw XRPL amount into the stage's big value and its unit. */
function formatAmount(amount: unknown): { value: string; unit: string } | null {
  if (typeof amount === "string") return { value: dropsToXrp(amount), unit: "XRP" };
  if (amount && typeof amount === "object") {
    const obj = amount as { value?: string; currency?: string; mpt_issuance_id?: string };
    return {
      value: obj.value ?? "0",
      unit: obj.currency ? decodeCurrency(obj.currency) : obj.mpt_issuance_id ? "MPT" : "",
    };
  }
  return null;
}

/**
 * The tx page's stage: what kind of transaction it is and whether it
 * went through, its hash, the amount it's about (labelled for what the
 * number is: delivered, escrowed, offered…), and who it was between.
 */
export default function TxHero({ tx }: { tx: TxData }) {
  const meta = tx.meta ?? tx.metaData;
  const tone = heroTone(meta?.TransactionResult);
  const hero = pickHeroAmount(tx, meta);
  const amount = hero ? formatAmount(hero.amount) : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 font-display text-caps uppercase">
        <span className="text-muted">Transaction</span>
        <span className={TONE_TEXT[tone]}>{TONE_LABEL[tone]}</span>
      </div>
      {/* The type is ledger data, so it keeps the data face. */}
      <h1 className="mt-3 break-words font-mono text-value text-primary">
        <span className="sr-only">Transaction: </span>
        {tx.TransactionType}
      </h1>
      <div className="mt-2 flex items-center gap-2">
        <span className="sr-only">Hash: </span>
        <span className="min-w-0 break-all font-mono text-cell text-primary">
          <Decode text={tx.hash} />
        </span>
        <CopyButton text={tx.hash} />
      </div>

      {hero && amount && (
        <div className="mt-10">
          <p className={`font-display text-caps uppercase tracking-header ${TONE_TEXT[hero.tone]}`}>{hero.label}</p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 font-mono tabular-nums">
            <span className="break-all text-figure text-primary sm:text-figure-lg">{amount.value}</span>
            <span className="text-value text-muted">{amount.unit}</span>
          </p>
        </div>
      )}

      {/* From always; To only when the tx is between two parties. */}
      <dl className="mt-8 space-y-2">
        <Party label="From" address={tx.Account} />
        {tx.Destination && <Party label="To" address={tx.Destination} destinationTag={tx.DestinationTag} />}
      </dl>
    </div>
  );
}

function Party({ label, address, destinationTag }: { label: string; address: string; destinationTag?: number }) {
  const known = getKnownName(address);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <dt className="w-12 shrink-0 font-display text-caps uppercase tracking-header text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-cell">
        <span className="min-w-0 break-all">
          <AddressLink address={address} truncate={false} />
        </span>
        {known && <span className="text-primary">{known}</span>}
        {destinationTag != null && (
          <span className="text-muted">
            Destination tag <span className="tabular-nums text-primary">{destinationTag}</span>
          </span>
        )}
      </dd>
    </div>
  );
}
