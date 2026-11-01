import { Link } from "react-router";
import TypeTag from "@/components/shared/TypeTag";
import StatusBadge from "@/components/shared/StatusBadge";
import AmountDisplay from "@/components/shared/AmountDisplay";
import type { RecentTx } from "@/types/live-data";

function short(value: string): string {
  return `${value.slice(0, 5)}...${value.slice(-4)}`;
}

/**
 * One linked transaction row, flush to the section edges, shared by the
 * ledger page list and the network page's latest transactions. Two
 * lines:
 *
 *   1. type tag + hash ........ amount
 *   2. From / To .............. status badge
 *
 * Built for 320px up. The amount and badge never shrink. The hash
 * truncates first, and the type tag only truncates when it alone is
 * wider than the space left. "To" wraps under "From" rather than
 * running into the badge.
 */
export default function LedgerTxRow({ tx }: { tx: RecentTx }) {
  const isSuccess = tx.result === "tesSUCCESS";
  return (
    <Link
      to={`/tx/${tx.hash}`}
      className="block border-b border-line py-2.5 last:border-b-0 hover:bg-row-hover -outline-offset-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TypeTag txType={tx.type} className="max-w-full shrink-0 truncate" />
          <span className="min-w-0 truncate font-mono text-cell text-muted">
            {short(tx.hash)}
          </span>
        </div>
        <div className="shrink-0">
          {tx.amount ? (
            <AmountDisplay drops={tx.amount} />
          ) : (
            <span className="font-mono text-cell text-muted">—</span>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-tag">
          <span className="max-w-full truncate text-muted">
            From <span className="text-primary">{short(tx.account)}</span>
          </span>
          {tx.destination && (
            <span className="max-w-full truncate text-muted">
              To <span className="text-primary">{short(tx.destination)}</span>
            </span>
          )}
        </div>
        <StatusBadge status={isSuccess ? "success" : "error"} className="shrink-0" />
      </div>
    </Link>
  );
}
