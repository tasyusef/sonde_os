import { Link } from "react-router";
import { useLatestLedger, useXrpl } from "@/hooks/useXrplWs";
import { formatInteger } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A square a little over half the x-height: 6px at 11px, 9px at 16.5px. */
function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn("size-[0.5455em] shrink-0", className)} />;
}

/** The connection, then the latest validated ledger once the stream has
 *  sent one. `compact` drops the tx count (mobile header). Not a live
 *  region: a ledger every few seconds would drown a screen reader. */
export function LedgerReadout({ compact = false }: { compact?: boolean }) {
  const { connected, unreachable } = useXrpl();
  const tick = useLatestLedger();

  if (unreachable) {
    return (
      <span className="flex items-center gap-2 text-error">
        <Dot className="bg-error-mark" />
        offline
      </span>
    );
  }
  if (!connected || !tick) {
    return (
      <span className="flex items-center gap-2 text-muted">
        <Dot className="bg-muted" />
        connecting
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2 text-muted">
      <Dot className="bg-success-mark" />
      {!compact && "ledger"}
      <Link
        to={`/ledger/${tick.index}`}
        aria-label={`Latest ledger, ${formatInteger(tick.index)}`}
        className="link-quiet tabular-nums text-primary"
      >
        {formatInteger(tick.index)}
      </Link>
      {!compact && tick.txCount != null && (
        <span className="tabular-nums">· {tick.txCount} txns</span>
      )}
    </span>
  );
}
