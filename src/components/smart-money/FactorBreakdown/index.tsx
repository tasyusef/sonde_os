import Tooltip from "@/components/shared/Tooltip";
import { cn } from "@/lib/utils";

interface Factor {
  name: string;
  weight: string;
  score: number; // 0-100
  tooltip: string;
}

interface Penalty {
  type: string;
  amount: number;
  reason: string;
}

interface FactorBreakdownProps {
  profitability: number;
  roi: number;
  winRate: number;
  consistency: number;
  earlyBuyer: number;
  smartExits: number;
  seasoning: number;
  penalties?: Penalty[];
}

function barColor(score: number): string {
  if (score >= 70) return "bg-success";
  if (score >= 40) return "bg-brand";
  return "bg-muted";
}

/**
 * Score factors + penalties body. Renders without its own card
 * chrome — the parent (`WalletDetailPage`) wraps it in a
 * `CollapsibleCard` so the section header + collapsible animation
 * are consistent with the other detail-page sections (Score
 * History, Tokens Traded).
 */
export default function FactorBreakdown({
  profitability,
  roi,
  winRate,
  consistency,
  earlyBuyer,
  smartExits,
  seasoning,
  penalties = [],
}: FactorBreakdownProps) {
  const factors: Factor[] = [
    { name: "Profitability", weight: "14%", score: profitability, tooltip: "Realized PnL percentile rank vs all scored wallets — capped at 95 so the very-top noise band can't single-handedly inflate the score" },
    { name: "ROI", weight: "23%", score: roi, tooltip: "Return on capital deployed. Sqrt curve calibrated for XRPL: 14x return = 100, 10x = 85, 4x = 53, 2x = 38" },
    { name: "Win Rate", weight: "12%", score: winRate, tooltip: "Percentage of tokens sold at a profit (per-token, not per-trade). >90% with >25 tokens triggers a bot-pattern penalty" },
    { name: "Consistency", weight: "12%", score: consistency, tooltip: "Sharpe ratio of per-token returns. Sharpe 4 = 100 (near-impossible), 3 = 75, 2 = 50, 1 = 25" },
    { name: "Early Buyer", weight: "14%", score: earlyBuyer, tooltip: "Squared curve over % of profitable PnL from tokens bought within 24h of their first-ever DEX trade. 100% early = 100, 90% = 81, 70% = 49" },
    { name: "Smart Exits", weight: "18%", score: smartExits, tooltip: "Squared curve over % of sells that preceded a >25% drawdown within 7 days. 100% smart = 100, 90% = 81, 75% = 56" },
    { name: "Seasoning", weight: "7%", score: seasoning, tooltip: "log10(wallet age in days) × log10(distinct counterparties), scaled to 0-100. Hard-to-fake signal — bot farms can game win-rate but can't fast-forward time or fake decades of organic counterparty diversity" },
  ];

  return (
    <>
      <div className="space-y-3 px-4 py-3">
        {factors.map((f) => (
          <div key={f.name} className="flex items-center gap-2 sm:gap-3">
            <div className="w-24 shrink-0 sm:w-28">
              <Tooltip content={f.tooltip} block>
                <span className="block font-mono text-cell font-medium leading-tight text-primary cursor-help">
                  {f.name}
                </span>
              </Tooltip>
              <span className="font-mono text-tag text-muted">{f.weight}</span>
            </div>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-elevated">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  barColor(f.score),
                )}
                style={{ width: `${Math.max(f.score, 1)}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-cell font-medium text-primary">
              {f.score.toFixed(0)}
            </span>
          </div>
        ))}
      </div>

      {penalties.length > 0 && (
        <div className="space-y-2 border-t border-elevated px-4 py-3">
          <span className="font-display text-label font-medium uppercase tracking-header text-error">
            Penalties
          </span>
          {penalties.map((p) => (
            <div key={p.type} className="flex items-center justify-between">
              <span className="font-mono text-cell text-primary">
                {p.reason}
              </span>
              <span className="font-mono text-cell font-medium text-error">
                -{p.amount}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
