import AddressLink from "@/components/shared/AddressLink";
import { formatCompactNumber } from "@/lib/xrpl-helpers";
import type { AMMPosition } from "@/types/amm";

function formatFee(fee: number): string {
  const pct = fee / 1000;
  return `${pct.toFixed(3).replace(/\.?0+$/, "")}%`;
}

function formatShare(pct: number): string {
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct >= 0.0001) return `${pct.toFixed(6)}%`;
  return "<0.0001%";
}

const thClass =
  "px-4 py-row font-display text-label font-medium uppercase tracking-header text-muted";

export default function AMMPoolList({
  ammPositions,
}: {
  ammPositions: AMMPosition[];
}) {
  if (ammPositions.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">
          No AMM positions found
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className={`${thClass} text-left`}>Pool</th>
            <th scope="col" className={`${thClass} text-right`}>LP Balance</th>
            <th scope="col" className={`${thClass} text-right`}>Pool Share</th>
            <th scope="col" className={`${thClass} hidden text-right sm:table-cell`}>
              Liquidity
            </th>
            <th scope="col" className={`${thClass} text-right`}>Fee</th>
          </tr>
        </thead>
        <tbody>
          {ammPositions.map((pos) => (
            <tr
              key={pos.ammAccount}
              className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
            >
              <td className="px-4 py-row">
                <span className="block truncate font-mono text-cell font-medium text-primary">
                  {pos.asset1Label} / {pos.asset2Label}
                </span>
                <span className="block text-tag">
                  <AddressLink address={pos.ammAccount} chars={6} />
                </span>
              </td>
              <td className="px-4 py-row text-right font-mono text-cell tabular-nums text-primary">
                {pos.lpTokenBalance.toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                })}
              </td>
              <td className="px-4 py-row text-right font-mono text-cell tabular-nums text-secondary">
                {formatShare(pos.sharePercent)}
              </td>
              <td className="hidden px-4 py-row text-right sm:table-cell">
                <span className="block font-mono text-cell tabular-nums text-primary">
                  {formatCompactNumber(pos.asset1Value)} {pos.asset1Label}
                </span>
                <span className="block font-mono text-tag tabular-nums text-muted">
                  {formatCompactNumber(pos.asset2Value)} {pos.asset2Label}
                </span>
              </td>
              <td className="px-4 py-row text-right font-mono text-cell tabular-nums text-muted">
                {formatFee(pos.tradingFee)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
