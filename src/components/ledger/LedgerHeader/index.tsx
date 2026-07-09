import { dropsToXrp, formatDate } from "@/lib/xrpl-helpers";
import CopyButton from "@/components/shared/CopyButton";
import { HeroBackground } from "@/components/shared/PageHero";

interface LedgerData {
  ledger_index: number;
  ledger_hash: string;
  close_time: number;
  parent_hash: string;
  total_coins: string;
}

export default function LedgerHeader({ ledger, txCount }: { ledger: LedgerData; txCount: number }) {
  return (
    <section className="relative mb-8 overflow-hidden md:-ml-18">
      <HeroBackground />

      <div className="relative mx-auto max-w-container px-4 pt-8 pb-4 sm:px-6 sm:pt-12 sm:pb-6 md:pl-24">
        <h1 className="mb-1 font-display text-title font-bold tracking-[-0.3px] text-primary">
          Ledger #{ledger.ledger_index.toLocaleString()}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono text-cell text-muted">
            {ledger.ledger_hash}
          </span>
          <CopyButton text={ledger.ledger_hash} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Close Time" value={formatDate(ledger.close_time)} />
          <StatCard
            label="Transactions"
            value={txCount.toLocaleString()}
          />
          <StatCard
            label="Total Coins"
            value={`${dropsToXrp(ledger.total_coins)} XRP`}
          />
          <StatCard label="Parent Hash" value={`${ledger.parent_hash.slice(0, 5)}...${ledger.parent_hash.slice(-4)}`} />
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl shadow-card bg-surface">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          {label}
        </span>
      </div>
      <div className="px-4 py-3">
        <p className="font-mono text-body font-medium text-primary break-all">
          {value}
        </p>
      </div>
    </div>
  );
}
