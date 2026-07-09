import CopyButton from "@/components/shared/CopyButton";
import type { AmendmentInfo } from "@/types/amendments";

interface EnabledAmendmentRowProps {
  amendment: AmendmentInfo;
}

function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
}

function formatEnabledDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Compact one-line row for ENABLED amendments. Enabled amendments are
 * tombstones — the vote happened, the feature is live, no chart, no
 * progress bar, no expand. Just name · hash · activation date.
 *
 * Used by AmendmentList in the "Enabled history" section. Stays tight
 * on mobile (single column, smaller padding) so 90+ rows don't blow
 * out the page.
 */
export function EnabledAmendmentRow({ amendment }: EnabledAmendmentRowProps) {
  const isHashName = amendment.name === amendment.hash;
  const displayName = isHashName ? truncateHash(amendment.hash) : amendment.name;

  return (
    <div className="flex items-center gap-3 border-b border-elevated px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-cell font-medium text-primary">
          {displayName}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate font-mono text-tag text-muted">
            {truncateHash(amendment.hash)}
          </span>
          <CopyButton text={amendment.hash} />
        </div>
      </div>
      <span className="shrink-0 font-mono text-tag tabular-nums text-muted">
        {formatEnabledDate(amendment.enabledAt)}
      </span>
    </div>
  );
}

export default EnabledAmendmentRow;
