/**
 * SectionHeader — title + count + optional loading status, used at the
 * top of in-tab data sections (Tokens, AMM Positions, Activations, etc).
 *
 * Pattern: replace generic skeletons with structural rendering. The
 * header appears immediately, status text narrates what's loading, the
 * count populates when known. Once data lands the status drops away
 * and the section header reads as a static label.
 *
 * Status copy convention: specific verbs + counts.
 *   ✅ "Loading 24 trustlines…"
 *   ✅ "Pricing 24 tokens…"
 *   ✅ "Resolved 240 of 800 NFTs…"
 *   ❌ "Loading…"
 */

import LoadingDots from "@/components/shared/LoadingDots";

interface SectionHeaderProps {
  /** Visible label, uppercase rendered. */
  title: string;
  /** Optional count badge inline with the title. Hidden when undefined. */
  count?: number;
  /**
   * Status text shown right of the title with a spinner. Pass `null`
   * or omit when the section has finished loading. Specific copy is
   * the whole point — see the convention above.
   */
  status?: string | null;
}

export default function SectionHeader({
  title,
  count,
  status,
}: SectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
      <span className="font-display text-label font-bold uppercase tracking-header text-brand">
        {title}
        {count != null && count > 0 && (
          <span className="ml-1.5 text-muted">({count})</span>
        )}
      </span>
      {status && (
        <span
          className="flex items-center gap-1.5 font-mono text-tag text-muted"
          role="status"
          aria-live="polite"
        >
          <LoadingDots className="text-brand" />
          {status}
        </span>
      )}
    </div>
  );
}

export { SectionHeader };
