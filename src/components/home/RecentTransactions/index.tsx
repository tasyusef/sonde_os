"use client";

import Link from "next/link";
import TypeTag from "@/components/shared/TypeTag";
import StatusBadge from "@/components/shared/StatusBadge";
import { dropsToXrp } from "@/lib/xrpl-helpers";
import { useLiveData } from "@/hooks/useLiveData";
import type { RecentTx } from "@/types/live-data";

export default function RecentTransactions({
  initialTxs,
  initialTotal,
}: {
  initialTxs: RecentTx[];
  initialTotal: number;
}) {
  const { transactions, txCount } = useLiveData();

  // Overlay live data when available, fall back to server-rendered props
  const txs = transactions ?? initialTxs;
  const total = txCount ?? initialTotal;

  if (txs.length === 0) {
    return (
      <div className="flex h-[520px] flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
        <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
          <span className="font-display text-label font-medium uppercase tracking-header text-muted">
            Latest Transactions
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <p className="font-mono text-body text-muted">Loading transactions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[520px] flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      {/* Header */}
      <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Latest Transactions
        </span>
        <span className="font-mono text-tag tabular-nums text-secondary">
          {total.toLocaleString()} <span className="text-muted">in ledger</span>
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {txs.map((tx) => {
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
                        {tx.destination.slice(0, 5)}...{tx.destination.slice(-4)}
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
