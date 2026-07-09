import { Card } from "@/components/shared/PreviewPrimitives";
import { cn } from "@/lib/utils";

/* ————————————————————————————————————————————
   Trustline growth winners tweet card.

   Tweet format: top tokens by net new trustlines over 7 days.
   Shows adoption momentum — which tokens are gaining holders
   fastest. Token communities love sharing these.
   ———————————————————————————————————————————— */

export interface TrustlineWinnersCardProps {
  tokens: {
    currency: string;
    netNew: number;
    added: number;
    removed: number;
  }[];
  /** Period label shown in header */
  period?: string;
}

const DEFAULT_PROPS: TrustlineWinnersCardProps = {
  tokens: [
    { currency: "USD", netNew: 1_842, added: 2_105, removed: 263 },
    { currency: "SOLOv2", netNew: 1_204, added: 1_380, removed: 176 },
    { currency: "CSC", netNew: 892, added: 1_034, removed: 142 },
    { currency: "CORE", netNew: 634, added: 791, removed: 157 },
    { currency: "XAH", netNew: 418, added: 502, removed: 84 },
  ],
  period: "7D",
};

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function TrustlineWinnersCard(
  props: Partial<TrustlineWinnersCardProps> = {},
) {
  const { tokens, period } = { ...DEFAULT_PROPS, ...props };

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-medium uppercase tracking-header text-muted">
          Trustline Growth
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted">
          {period}
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
        <span className="font-display text-tag uppercase tracking-header text-muted text-right">
          Net New
        </span>
      </div>

      {/* Token rows */}
      {tokens.slice(0, 5).map((token, i) => (
        <div
          key={`${token.currency}-${i}`}
          className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-elevated px-4 py-2.5 last:border-b-0"
        >
          <span className="w-6 font-mono text-cell tabular-nums text-muted text-center">
            {i + 1}
          </span>
          <div className="min-w-0">
            <span className="font-mono text-cell font-medium text-primary">
              {token.currency}
            </span>
            <span className="ml-2 font-mono text-tag text-muted">
              +{formatCount(token.added)} / −{formatCount(token.removed)}
            </span>
          </div>
          <span
            className={cn(
              "font-mono text-cell font-medium tabular-nums text-right",
              token.netNew >= 0 ? "text-success" : "text-error",
            )}
          >
            {token.netNew >= 0 ? "+" : ""}
            {formatCount(token.netNew)}
          </span>
        </div>
      ))}
    </Card>
  );
}

export default TrustlineWinnersCard;
