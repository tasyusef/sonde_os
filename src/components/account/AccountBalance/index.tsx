import { formatVolume } from "@/lib/format";
import { dropsToXrp } from "@/lib/xrpl-helpers";

/** The account stage's figure: the XRP balance and its worth in USD. */
export default function AccountBalance({ drops, xrpPrice }: { drops: string; xrpPrice: number }) {
  const xrp = dropsToXrp(drops);

  return (
    <div>
      <p className="font-display text-caps uppercase tracking-header text-muted">Balance</p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 font-mono tabular-nums">
        <span className="text-figure text-primary sm:text-figure-lg">{xrp}</span>
        <span className="text-value text-muted">XRP</span>
      </p>
      {xrpPrice > 0 && (
        <p className="mt-1 font-mono text-cell tabular-nums text-muted">
          {formatVolume(parseFloat(xrp) * xrpPrice)}
        </p>
      )}
    </div>
  );
}

export { AccountBalance };
