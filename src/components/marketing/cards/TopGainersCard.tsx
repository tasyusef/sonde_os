import { Card } from "@/components/shared/PreviewPrimitives";

/* ————————————————————————————————————————————
   Top 24h gainers tweet card.

   Tweet format: top 5 XRPL tokens by 24h price change %, filtered
   to tokens with meaningful 24h volume (≥10K XRP) so thin-book
   spikes don't top the board. Green accent — token communities
   share gainer lists aggressively.
   ———————————————————————————————————————————— */

export interface TopGainersCardProps {
  gainers: {
    /** Decoded ticker (e.g. "SOLO"). */
    token: string;
    /** 24h XRP-volume, used as a liquidity-proof subhead. */
    volumeXrp: number;
    /** 24h % change — positive for this card. */
    pctChange: number;
  }[];
}

const DEFAULT_PROPS: TopGainersCardProps = {
  gainers: [
    { token: "SOLO", volumeXrp: 1_240_000, pctChange: 24.6 },
    { token: "CSC", volumeXrp: 842_000, pctChange: 18.3 },
    { token: "CORE", volumeXrp: 611_000, pctChange: 14.1 },
    { token: "XAH", volumeXrp: 498_000, pctChange: 9.7 },
    { token: "RLUSD", volumeXrp: 2_140_000, pctChange: 6.4 },
  ],
};

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function TopGainersCard(
  props: Partial<TopGainersCardProps> = {},
) {
  const { gainers } = { ...DEFAULT_PROPS, ...props };
  const maxPct = Math.max(...gainers.map((g) => g.pctChange), 1);

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          Top Gainers
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted">
          24H
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-elevated px-4 py-1.5">
        <span className="w-6 font-display text-tag uppercase tracking-header text-muted text-center">
          #
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted">
          Token
        </span>
        <span className="w-[100px] font-display text-tag uppercase tracking-header text-muted text-right">
          Change
        </span>
      </div>

      {/* Gainer rows */}
      {gainers.slice(0, 5).map((g, i) => {
        const pct = (g.pctChange / maxPct) * 100;
        return (
          <div
            key={`${g.token}-${i}`}
            className="relative grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-elevated px-4 py-2.5 last:border-b-0"
          >
            {/* % bar background */}
            <div
              className="absolute inset-y-0 left-0 bg-success/8"
              style={{ width: `${pct}%` }}
            />
            <span className="relative w-6 font-mono text-cell tabular-nums text-muted text-center">
              {i + 1}
            </span>
            <div className="relative min-w-0">
              <span className="font-mono text-cell font-medium text-primary">
                {g.token}
              </span>
              <span className="ml-2 font-mono text-tag text-muted tabular-nums">
                {formatVolume(g.volumeXrp)} XRP vol
              </span>
            </div>
            <span className="relative w-[100px] font-mono text-cell font-medium tabular-nums text-success text-right">
              {formatPct(g.pctChange)}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

export default TopGainersCard;
