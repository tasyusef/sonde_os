import CopyButton from "@/components/shared/CopyButton";
import Decode from "@/components/shared/Decode";
import { formatInteger } from "@/lib/format";
import type { ExpandedLedger } from "@/lib/ledger-txs";

/** The ledger page's stage: which ledger, its hash, and how many
 *  transactions it closed with. */
export default function LedgerHero({ ledger, txCount }: { ledger: ExpandedLedger; txCount: number }) {
  return (
    <div>
      <p className="font-display text-caps uppercase text-muted">Ledger</p>
      {/* The index is ledger data, so it keeps the data face. */}
      <h1 className="mt-3 font-mono text-value tabular-nums text-primary">
        <span className="sr-only">Ledger </span>
        {formatInteger(ledger.ledger_index)}
      </h1>
      <div className="mt-2 flex items-center gap-2">
        <span className="sr-only">Hash: </span>
        <span className="min-w-0 break-all font-mono text-cell text-primary">
          <Decode text={ledger.ledger_hash} />
        </span>
        <CopyButton text={ledger.ledger_hash} />
      </div>

      <div className="mt-10">
        <p className="font-display text-caps uppercase tracking-header text-muted">Transactions</p>
        <p className="mt-2 font-mono text-figure tabular-nums text-primary sm:text-figure-lg">
          {formatInteger(txCount)}
        </p>
      </div>
    </div>
  );
}
