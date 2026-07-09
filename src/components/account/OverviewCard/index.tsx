import { formatVolume } from "@/lib/format";
import { formatDate } from "@/lib/xrpl-helpers";
import CopyButton from "@/components/shared/CopyButton";

interface OverviewCardProps {
  /** XRPL account address — shown in the card header alongside the BALANCE
   *  label with a copy-to-clipboard button. Lets us drop the address out
   *  of the page hero so the hero can be tighter / removed on mobile. */
  address: string;
  /** XRP balance as a decimal string (already dropsToXrp converted) */
  xrpBalanceDisplay: string;
  xrpValueUsd: number;
  xrpPrice: number;
  /** Total portfolio value in USD (xrp + tokens + amm + nfts + locked). Null
   *  while the monolithic data fetch is still in flight — the stat will
   *  render "—" as a placeholder so the card can show balance + reserve
   *  immediately from server-known data. */
  totalValueUsd: number | null;
  /** XRP reserve (base + owner*count) */
  reserveXrp: number;
  availableXrp: number;
  /** Account activation date in XRPL epoch seconds — null if unknown or not loaded yet */
  activationDate: number | null;
  /** Age label like "2.3y" or "187d" — null if unknown or not loaded yet */
  ageLabel: string | null;
}

/**
 * One-card account summary. Replaces the old 10-card stat grid with just
 * the four fields that actually matter at a glance: current XRP balance,
 * total portfolio value in USD, reserve + available, and account age.
 *
 * The rest (Sequence, Objects, Flags, MintedNFTokens, etc.) moves into the
 * Profile tab where power users can find them without cluttering the
 * default view.
 */
export default function OverviewCard({
  address,
  xrpBalanceDisplay,
  xrpValueUsd,
  xrpPrice,
  totalValueUsd,
  reserveXrp,
  availableXrp,
  activationDate,
  ageLabel,
}: OverviewCardProps) {
  const reserveLabel = reserveXrp.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const availableLabel = availableXrp.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

  return (
    <section
      aria-label="Account overview"
      className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card"
    >
      {/* Balance header — absorbs the page-hero's address display so the
           hero can shrink / disappear on mobile. */}
      <div className="flex items-center justify-between gap-2 border-b border-elevated px-4 py-1.5">
        <span className="flex shrink-0 items-center gap-1.5 font-display text-label font-medium uppercase tracking-header text-muted">
          <span className="inline-block size-1.5 rounded-full bg-brand" aria-hidden="true" />
          Balance
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-label text-secondary">
            {address}
          </span>
          <CopyButton text={address} />
        </div>
      </div>
      <div className="px-6 py-5">
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-display font-medium tabular-nums text-brand sm:text-display-lg">
            {xrpBalanceDisplay}
          </p>
          <p className="font-mono text-heading font-medium text-muted">XRP</p>
        </div>
        {xrpPrice > 0 && (
          <p className="mt-1 font-mono text-cell tabular-nums text-secondary">
            {formatVolume(xrpValueUsd)}
          </p>
        )}
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-3 border-t border-elevated divide-x divide-elevated">
        <Stat label="Total Value" accent>
          {xrpPrice > 0 && totalValueUsd != null ? formatVolume(totalValueUsd) : "—"}
        </Stat>
        <Stat label="Reserve" sub={`${availableLabel} avail.`}>
          {reserveLabel} XRP
        </Stat>
        <Stat
          label="Age"
          sub={activationDate != null ? formatDate(activationDate) : undefined}
        >
          {ageLabel ?? "—"}
        </Stat>
      </div>
    </section>
  );
}

function Stat({
  label,
  children,
  sub,
  accent = false,
}: {
  label: string;
  children: React.ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <span className="block font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </span>
      <p
        className={`mt-1 truncate font-mono text-cell font-medium tabular-nums ${
          accent ? "text-brand" : "text-primary"
        }`}
      >
        {children}
      </p>
      {sub && (
        <p className="mt-0.5 truncate font-mono text-tag text-muted">{sub}</p>
      )}
    </div>
  );
}
