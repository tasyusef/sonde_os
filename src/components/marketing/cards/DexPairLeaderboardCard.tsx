import { Card } from "@/components/shared/PreviewPrimitives";

/* ————————————————————————————————————————————
   DEX pair leaderboard tweet card.

   Tweet format: top 5 trading pairs on XRPL by 7-day volume.
   Horizontal volume bars give instant visual ranking — traders
   tag token communities, driving retweets.
   ———————————————————————————————————————————— */

export interface DexPairLeaderboardCardProps {
  pairs: {
    base: string;
    quote: string;
    trades: number;
    volumeXrp: number;
  }[];
  /** Period label shown in header */
  period?: string;
}

const DEFAULT_PROPS: DexPairLeaderboardCardProps = {
  pairs: [
    { base: "USD", quote: "XRP", trades: 14_832, volumeXrp: 28_400_000 },
    { base: "SOLOv2", quote: "XRP", trades: 9_241, volumeXrp: 12_750_000 },
    { base: "CSC", quote: "XRP", trades: 7_610, volumeXrp: 8_920_000 },
    { base: "CORE", quote: "XRP", trades: 5_384, volumeXrp: 4_310_000 },
    { base: "XAH", quote: "XRP", trades: 3_122, volumeXrp: 2_180_000 },
  ],
  period: "7D",
};

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatTrades(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function DexPairLeaderboardCard(
  props: Partial<DexPairLeaderboardCardProps> = {},
) {
  const { pairs, period } = { ...DEFAULT_PROPS, ...props };
  const maxVolume = Math.max(...pairs.map((p) => p.volumeXrp), 1);

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          Top DEX Pairs
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted">
          {period}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-elevated px-4 py-1.5">
        <span className="font-display text-tag uppercase tracking-header text-muted">
          Pair
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted text-right">
          Trades
        </span>
        <span className="w-[100px] font-display text-tag uppercase tracking-header text-muted text-right">
          Volume
        </span>
      </div>

      {/* Pair rows */}
      {pairs.slice(0, 5).map((pair, i) => {
        const pct = (pair.volumeXrp / maxVolume) * 100;
        return (
          <div
            key={`${pair.base}-${pair.quote}-${i}`}
            className="relative grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-elevated px-4 py-2.5 last:border-b-0"
          >
            {/* Volume bar background */}
            <div
              className="absolute inset-y-0 left-0 bg-brand/8"
              style={{ width: `${pct}%` }}
            />
            <span className="relative font-mono text-cell font-medium text-primary">
              {pair.base}{" "}
              <span className="text-muted">/</span>{" "}
              <span className="text-secondary">{pair.quote}</span>
            </span>
            <span className="relative font-mono text-cell tabular-nums text-muted text-right">
              {formatTrades(pair.trades)}
            </span>
            <span className="relative w-[100px] font-mono text-cell tabular-nums text-primary text-right">
              {formatVolume(pair.volumeXrp)} XRP
            </span>
          </div>
        );
      })}
    </Card>
  );
}

export default DexPairLeaderboardCard;
