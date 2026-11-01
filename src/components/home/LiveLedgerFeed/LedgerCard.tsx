import { useMemo, useState, useEffect, memo } from "react";
import { Link } from "react-router";
import { XRPL_EPOCH, dropsToXrp, getTypeFamily, getTypeColor } from "@/lib/xrpl-helpers";
import type { TxSummary } from "@/types/live-data";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(rippleTime: number): string {
  const now = Math.floor(Date.now() / 1000);
  const ledgerUnix = rippleTime + XRPL_EPOCH;
  const diff = now - ledgerUnix;
  if (diff < 2) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function useTimeAgo(rippleTime: number): string {
  const [label, setLabel] = useState(() => timeAgo(rippleTime));
  useEffect(() => {
    const id = setInterval(() => setLabel(timeAgo(rippleTime)), 1000);
    return () => clearInterval(id);
  }, [rippleTime]);
  return label;
}

interface FamilyShare {
  family: string;
  color: string;
  count: number;
}

function buildFamilyShares(txSummaries: TxSummary[]): FamilyShare[] {
  const counts = new Map<string, { color: string; count: number }>();
  for (const tx of txSummaries) {
    const family = getTypeFamily(tx.type);
    const existing = counts.get(family);
    if (existing) {
      existing.count++;
    } else {
      counts.set(family, { color: getTypeColor(tx.type), count: 1 });
    }
  }
  return Array.from(counts.entries())
    .map(([family, { color, count }]) => ({ family, color, count }))
    .sort((a, b) => b.count - a.count);
}

interface LedgerCardProps {
  ledgerIndex: number;
  ledgerTime: number;
  txnCount: number;
  txSummaries?: TxSummary[];
  totalFees?: string;
}

/**
 * One ledger in the live strip: its index and age, tx count and fee
 * burned, a proportional bar of tx-type families, and their legend.
 * A fixed width and a 6px bar keep every column the same compact
 * shape whatever the ledger's size; per-family counts are in the
 * legend.
 */
function LedgerCardInner({ ledgerIndex, ledgerTime, txnCount, txSummaries, totalFees }: LedgerCardProps) {
  const families = useMemo(() => (txSummaries ? buildFamilyShares(txSummaries) : []), [txSummaries]);
  const total = families.reduce((s, f) => s + f.count, 0);

  const feeXrp = totalFees ? dropsToXrp(totalFees) : null;
  const relativeTime = useTimeAgo(ledgerTime);

  return (
    <div className="w-[260px]">
      <div className="flex items-baseline gap-2">
        <Link to={`/ledger/${ledgerIndex}`} className="link font-mono text-ui tabular-nums text-primary">
          {ledgerIndex.toLocaleString()}
        </Link>
        <span className="font-mono text-tag text-muted">{relativeTime}</span>
      </div>
      <p className="mt-1 font-mono text-tag tabular-nums text-primary">
        {txnCount} <span className="text-muted">txn{txnCount !== 1 ? "s" : ""}</span>
        {feeXrp && (
          <span className="text-muted">
            {" · "}
            {feeXrp} XRP burned
          </span>
        )}
      </p>

      {families.length > 0 ? (
        <>
          <div className="mt-3 flex h-1.5 overflow-hidden bg-elevated">
            {families.map((f) => (
              <div
                key={f.family}
                className="h-full"
                style={{ width: `${(f.count / total) * 100}%`, backgroundColor: f.color }}
                title={`${f.family}: ${f.count}`}
                aria-label={`${f.family}: ${f.count}`}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            {families.map((item) => (
              <div key={item.family} className="flex items-center gap-1">
                <span
                  className="inline-block size-2 rounded-swatch"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <span className="font-mono text-tag text-muted">{item.family}</span>
                <span className="font-mono text-tag tabular-nums text-primary">{item.count}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-3 font-mono text-tag text-muted">No transaction data</p>
      )}
    </div>
  );
}

const LedgerCard = memo(LedgerCardInner);
export default LedgerCard;
