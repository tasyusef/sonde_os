import { Card, Row } from "@/components/shared/PreviewPrimitives";
import { cn } from "@/lib/utils";

/* ————————————————————————————————————————————
   Whale flag tweet card.

   Tweet format: a single high-signal whale move with from/to addresses,
   amount, timestamp, and an optional smart money tier badge. Designed
   to be scanned in 2 seconds — the amount is the focal point.
   ———————————————————————————————————————————— */

type SmartMoneyTier = "elite" | "advanced" | "skilled" | "watching";

export interface WhaleFlagCardProps {
  /** Amount in XRP (already converted from drops) */
  amountXrp: number;
  /** Optional currency label — defaults to "XRP" */
  currency?: string;
  fromAddress: string;
  toAddress: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Optional smart money score 0–100 */
  smartMoneyScore?: number;
  /** Optional tier label that drives the badge color */
  smartMoneyTier?: SmartMoneyTier;
}

const DEFAULT_PROPS: WhaleFlagCardProps = {
  amountXrp: 2_450_000,
  currency: "XRP",
  fromAddress: "rN7d4kFP2eYSiUbY8u6yzLcQv9D8XQqkF92",
  toAddress: "rPqB8XYz31Ftv7Bk4DPn1xWmRcZJxZ31",
  timestamp: "2026-04-10T15:42:00Z",
  smartMoneyScore: 87,
  smartMoneyTier: "elite",
};

const TIER_COLOR: Record<SmartMoneyTier, string> = {
  elite: "text-brand",
  advanced: "text-chart-blue",
  skilled: "text-chart-emerald",
  watching: "text-muted",
};

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.max(0, Math.round((now - then) / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

export function WhaleFlagCard(props: Partial<WhaleFlagCardProps> = {}) {
  const {
    amountXrp,
    currency,
    fromAddress,
    toAddress,
    timestamp,
    smartMoneyScore,
    smartMoneyTier,
  } = { ...DEFAULT_PROPS, ...props };

  const tierColor = smartMoneyTier ? TIER_COLOR[smartMoneyTier] : "text-muted";

  return (
    <Card>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-medium uppercase tracking-header text-muted">
          Whale Activity
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted">
          {formatRelativeTime(timestamp)}
        </span>
      </div>

      {/* Hero amount */}
      <div className="px-6 py-8 text-center">
        <div className="font-mono text-display-lg font-medium tabular-nums text-primary">
          {formatAmount(amountXrp)}
        </div>
        <div className="mt-1 font-display text-tag font-medium uppercase tracking-header text-muted">
          {currency}
        </div>
      </div>

      {/* From → To row */}
      <Row
        label="From"
        value={
          <span className="text-brand">{truncateAddress(fromAddress)}</span>
        }
      />
      <Row
        label="To"
        value={<span className="text-brand">{truncateAddress(toAddress)}</span>}
      />

      {/* Smart money score row, if present */}
      {smartMoneyScore !== undefined && smartMoneyTier && (
        <Row
          label="Smart Money"
          value={
            <span className={cn("font-medium", tierColor)}>
              {smartMoneyScore}{" "}
              <span className="ml-1 text-tag uppercase tracking-header">
                {smartMoneyTier}
              </span>
            </span>
          }
        />
      )}
    </Card>
  );
}

export default WhaleFlagCard;
