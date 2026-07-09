import {
  Card,
  PreviewAreaChart,
  Row,
} from "@/components/shared/PreviewPrimitives";
import { cn } from "@/lib/utils";

const SPARKLINE_BASE_MS = new Date("2026-03-15T00:00:00Z").getTime();
const SPARKLINE_DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic 30-day PnL sparkline, steadily climbing with realistic jitter. */
const DEFAULT_PNL_SERIES: { timestamp: number; value: number }[] = [
  12_400, 13_850, 13_220, 14_980, 16_110, 15_470, 17_240, 18_560, 19_120,
  18_470, 20_310, 21_840, 22_590, 21_920, 23_850, 25_480, 26_120, 24_980,
  27_340, 29_410, 30_280, 28_960, 32_110, 34_840, 36_530, 35_420, 38_720,
  41_680, 45_190, 48_210,
].map((value, i) => ({
  timestamp: SPARKLINE_BASE_MS + i * SPARKLINE_DAY_MS,
  value,
}));

/* ————————————————————————————————————————————
   Smart money wallet spotlight tweet card.

   Tweet format: a single XRPL wallet's profile — composite score, tier,
   PnL, win rate, trade count, and tokens traded. Optional sparkline of
   PnL over time. Designed to be the "this wallet has been quietly
   crushing it" reveal post.
   ———————————————————————————————————————————— */

type SmartMoneyTier = "elite" | "advanced" | "skilled" | "watching";

export interface SmartMoneySpotlightCardProps {
  address: string;
  /** 0–100 composite score */
  compositeScore: number;
  tier: SmartMoneyTier;
  totalPnlXrp: number;
  /** 0–100 win rate */
  winRate: number;
  totalTrades: number;
  tokensTraded: number;
  /** Optional period label for the score window */
  windowLabel?: string;
}

const DEFAULT_PROPS: SmartMoneySpotlightCardProps = {
  address: "rN7d4kFP2eYSiUbY8u6yzLcQv9D8XQqkF92",
  compositeScore: 94,
  tier: "elite",
  totalPnlXrp: 48_210,
  winRate: 71,
  totalTrades: 312,
  tokensTraded: 18,
  windowLabel: "30D",
};

const TIER_STYLE: Record<SmartMoneyTier, { color: string; bg: string }> = {
  elite: { color: "text-brand", bg: "bg-brand/10" },
  advanced: { color: "text-chart-blue", bg: "bg-chart-blue/10" },
  skilled: { color: "text-chart-emerald", bg: "bg-chart-emerald/10" },
  watching: { color: "text-muted", bg: "bg-elevated" },
};

function formatXrp(n: number): string {
  const sign = n >= 0 ? "+" : "";
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(n);
  return `${sign}${formatted}`;
}

export function SmartMoneySpotlightCard(
  props: Partial<SmartMoneySpotlightCardProps> = {},
) {
  const {
    address,
    compositeScore,
    tier,
    totalPnlXrp,
    winRate,
    totalTrades,
    tokensTraded,
    windowLabel,
  } = { ...DEFAULT_PROPS, ...props };

  const tierStyle = TIER_STYLE[tier];

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          Smart Money Spotlight
        </span>
        {windowLabel && (
          <span className="font-display text-tag uppercase tracking-header text-muted">
            {windowLabel}
          </span>
        )}
      </div>

      {/* Wallet hero */}
      <div className="px-6 pt-6 pb-3 text-center">
        <div className="break-all font-mono text-cell text-brand">
          {address}
        </div>
      </div>

      {/* Score + tier */}
      <div className="flex items-baseline justify-center gap-3 px-6 pb-6">
        <span className="font-mono text-display font-medium tabular-nums text-primary">
          {compositeScore}
        </span>
        <span
          className={cn(
            "rounded-tag px-2 py-0.5 font-display text-tag font-medium uppercase tracking-header",
            tierStyle.color,
            tierStyle.bg,
          )}
        >
          {tier}
        </span>
      </div>

      {/* Mini sparkline */}
      <div className="border-t border-elevated px-4 py-3">
        <PreviewAreaChart
          data={DEFAULT_PNL_SERIES}
          color="var(--color-success)"
          height={80}
          showXAxis={false}
          showYAxis={false}
          showGrid={false}
        />
      </div>

      {/* Stats grid via Row */}
      <Row
        label="Total PnL"
        value={
          <span className={totalPnlXrp >= 0 ? "text-success" : "text-error"}>
            {formatXrp(totalPnlXrp)} XRP
          </span>
        }
      />
      <Row label="Win Rate" value={`${winRate}%`} />
      <Row label="Trades" value={totalTrades.toLocaleString()} />
      <Row label="Tokens Traded" value={tokensTraded.toString()} />
    </Card>
  );
}

export default SmartMoneySpotlightCard;
