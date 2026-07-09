import Link from "next/link";
import CopyButton from "@/components/shared/CopyButton";
import { formatVolume } from "@/lib/format";

interface SmartMoneyOverviewCardProps {
  address: string;
  /** Composite score 0-100. The headline metric — sits where the
   *  XRP balance sits on the account OverviewCard. */
  compositeScore: number;
  /** Total realized PnL in XRP (signed). Rendered as the USD-style
   *  sub-line beneath the big score, matching OverviewCard's
   *  XRP→USD pairing. */
  totalPnlXrp: number;
  winRate: number;
  sharpeRatio: number;
  totalTrades: number;
  tokensTraded: number;
  /** Wash-trading flag — when set, replaces the green status dot in
   *  the header with a red "WASH" pill. Mirrors how the account
   *  page's overview card surfaces a degraded state. */
  washFlagged?: boolean;
}

/**
 * Smart-money detail-page overview card. Same shape as
 * `account/OverviewCard`: header strip with status dot + label +
 * address + copy, big primary value + sub-line, 3-col stats strip
 * with `divide-x` separators.
 *
 * Replaces the old "score gauge + 5-stat grid" block which was a
 * chunky vertical chunk on mobile (gauge took ~140px, stats took
 * another ~180px). Compresses to a single ~280px card with the same
 * five facts surfaced (PnL, win rate, sharpe, tokens, trades) plus
 * the composite score as the hero number.
 */
export default function SmartMoneyOverviewCard({
  address,
  compositeScore,
  totalPnlXrp,
  winRate,
  sharpeRatio,
  totalTrades,
  tokensTraded,
  washFlagged = false,
}: SmartMoneyOverviewCardProps) {
  const pnlSign = totalPnlXrp >= 0 ? "+" : "-";
  const pnlAbs = Math.abs(totalPnlXrp);
  const pnlFormatted =
    pnlAbs >= 1_000_000
      ? `${(pnlAbs / 1_000_000).toFixed(2)}M`
      : pnlAbs >= 1_000
        ? `${(pnlAbs / 1_000).toFixed(1)}K`
        : pnlAbs.toFixed(2);

  return (
    <section
      aria-label="Smart money overview"
      className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card"
    >
      {/* Header — status dot + label on the left, truncated address +
           copy on the right. Same shape as OverviewCard's BALANCE
           strip. */}
      <div className="flex items-center justify-between gap-2 border-b border-elevated px-4 py-1.5">
        <span className="flex shrink-0 items-center gap-1.5 font-display text-label font-medium uppercase tracking-header text-muted">
          {washFlagged ? (
            <span
              className="rounded-tag bg-error/10 px-1.5 py-0.5 font-mono text-tag font-semibold text-error"
              title="Wash trading activity detected — score has been penalized"
            >
              Wash
            </span>
          ) : (
            <span
              className="inline-block size-1.5 rounded-full bg-brand"
              aria-hidden="true"
            />
          )}
          Smart Money
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/account/${address}`}
            className="truncate font-mono text-label text-secondary transition-colors hover:text-brand"
            title="Open in Explorer"
          >
            {address}
          </Link>
          <CopyButton text={address} />
        </div>
      </div>

      {/* Hero — composite score as the big number, total PnL as the
           sub-line. Mirrors OverviewCard's XRP balance + USD pairing. */}
      <div className="px-6 py-5">
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-display font-medium tabular-nums text-brand sm:text-display-lg">
            {compositeScore.toFixed(0)}
          </p>
          <p className="font-mono text-heading font-medium text-muted">/100</p>
        </div>
        <p
          className={`mt-1 font-mono text-cell tabular-nums ${
            totalPnlXrp >= 0 ? "text-success" : "text-error"
          }`}
        >
          {pnlSign}
          {pnlFormatted} XRP PnL
        </p>
      </div>

      {/* 3-col stats strip — same divide-x pattern OverviewCard uses
           for its Total Value / Reserve / Age row. */}
      <div className="grid grid-cols-3 divide-x divide-elevated border-t border-elevated">
        <Stat label="Win Rate">{`${winRate.toFixed(0)}%`}</Stat>
        <Stat label="Sharpe">{sharpeRatio.toFixed(2)}</Stat>
        <Stat
          label="Trades"
          sub={`${tokensTraded} token${tokensTraded === 1 ? "" : "s"}`}
        >
          {formatVolume(totalTrades)}
        </Stat>
      </div>
    </section>
  );
}

function Stat({
  label,
  children,
  sub,
}: {
  label: string;
  children: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <span className="block font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </span>
      <p className="mt-1 truncate font-mono text-cell font-medium tabular-nums text-primary">
        {children}
      </p>
      {sub && (
        <p className="mt-0.5 truncate font-mono text-tag text-muted">{sub}</p>
      )}
    </div>
  );
}
