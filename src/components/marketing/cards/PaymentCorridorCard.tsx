import { Card } from "@/components/shared/PreviewPrimitives";

/* ————————————————————————————————————————————
   Payment corridor tweet card.

   Tweet format: top 5 payment routes on XRPL by volume.
   SRC → DST currency flows with volume bars. Unique to XRPL —
   nobody else surfaces cross-currency corridor data visually.
   ———————————————————————————————————————————— */

export interface PaymentCorridorCardProps {
  corridors: {
    srcCurrency: string;
    dstCurrency: string;
    count: number;
    volumeXrp: number;
  }[];
  /** Period label shown in header */
  period?: string;
}

const DEFAULT_PROPS: PaymentCorridorCardProps = {
  corridors: [
    { srcCurrency: "XRP", dstCurrency: "USD", count: 8_421, volumeXrp: 42_100_000 },
    { srcCurrency: "USD", dstCurrency: "XRP", count: 6_230, volumeXrp: 31_500_000 },
    { srcCurrency: "XRP", dstCurrency: "EUR", count: 3_814, volumeXrp: 18_200_000 },
    { srcCurrency: "XRP", dstCurrency: "JPY", count: 2_105, volumeXrp: 9_800_000 },
    { srcCurrency: "BTC", dstCurrency: "XRP", count: 1_442, volumeXrp: 7_250_000 },
  ],
  period: "7D",
};

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function PaymentCorridorCard(
  props: Partial<PaymentCorridorCardProps> = {},
) {
  const { corridors, period } = { ...DEFAULT_PROPS, ...props };
  const maxVolume = Math.max(...corridors.map((c) => c.volumeXrp), 1);

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          Payment Corridors
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted">
          {period}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-elevated px-4 py-1.5">
        <span className="font-display text-tag uppercase tracking-header text-muted">
          Route
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted text-right">
          Txns
        </span>
        <span className="w-[100px] font-display text-tag uppercase tracking-header text-muted text-right">
          Volume
        </span>
      </div>

      {/* Corridor rows */}
      {corridors.slice(0, 5).map((corridor, i) => {
        const pct = (corridor.volumeXrp / maxVolume) * 100;
        return (
          <div
            key={`${corridor.srcCurrency}-${corridor.dstCurrency}-${i}`}
            className="relative grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-elevated px-4 py-2.5 last:border-b-0"
          >
            {/* Volume bar background */}
            <div
              className="absolute inset-y-0 left-0 bg-brand/8"
              style={{ width: `${pct}%` }}
            />
            <span className="relative font-mono text-cell font-medium text-primary">
              {corridor.srcCurrency}{" "}
              <span className="text-muted">→</span>{" "}
              <span className="text-secondary">{corridor.dstCurrency}</span>
            </span>
            <span className="relative font-mono text-cell tabular-nums text-muted text-right">
              {formatCount(corridor.count)}
            </span>
            <span className="relative w-[100px] font-mono text-cell tabular-nums text-primary text-right">
              {formatVolume(corridor.volumeXrp)} XRP
            </span>
          </div>
        );
      })}
    </Card>
  );
}

export default PaymentCorridorCard;
