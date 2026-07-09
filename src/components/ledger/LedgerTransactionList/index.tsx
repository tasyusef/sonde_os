import Link from "next/link";
import TypeTag from "@/components/shared/TypeTag";
import StatusBadge from "@/components/shared/StatusBadge";
import { type RecentTx } from "@/lib/xrpl-data";
import { dropsToXrp } from "@/lib/xrpl-helpers";

export default function LedgerTransactionList({
  transactions,
}: {
  transactions: RecentTx[];
}) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">
          No transactions in this ledger
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 font-display text-tag font-medium uppercase tracking-header text-muted">
        Transactions ({transactions.length})
      </h2>
      <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
        {transactions.map((tx) => {
          const isSuccess = tx.result === "tesSUCCESS";
          return (
            <Link
              key={tx.hash}
              href={`/tx/${tx.hash}`}
              className="block border-b border-elevated px-4 py-2.5 transition-colors hover:bg-row-hover"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <TypeTag txType={tx.type} />
                  <span className="font-mono text-cell text-muted">
                    {tx.hash.slice(0, 5)}...{tx.hash.slice(-4)}
                  </span>
                </div>
                <div className="shrink-0">
                  {tx.amount ? (
                    <span className="font-mono text-cell tabular-nums text-primary">
                      {dropsToXrp(tx.amount)}{" "}
                      <span className="text-muted">XRP</span>
                    </span>
                  ) : (
                    <span className="font-mono text-cell text-muted">—</span>
                  )}
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-3 font-mono text-tag">
                  <span className="flex items-center gap-1 text-muted">
                    From{" "}
                    <span className="text-secondary">
                      {tx.account.slice(0, 5)}...{tx.account.slice(-4)}
                    </span>
                  </span>
                  {tx.destination && (
                    <span className="flex items-center gap-1 text-muted">
                      To{" "}
                      <span className="text-secondary">
                        {tx.destination.slice(0, 5)}...
                        {tx.destination.slice(-4)}
                      </span>
                    </span>
                  )}
                </div>
                <StatusBadge status={isSuccess ? "success" : "error"} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
