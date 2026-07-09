"use client";

import { useMemo } from "react";
import AmendmentCard from "@/components/amendments/AmendmentCard";
import EnabledAmendmentRow from "@/components/amendments/EnabledAmendmentRow";
import type { AmendmentInfo, AmendmentVotePoint } from "@/types/amendments";

interface AmendmentListProps {
  initialAmendments: AmendmentInfo[];
  sparklineMap?: Record<string, AmendmentVotePoint[]>;
}

/**
 * Two-track layout — splits amendments by their actual semantic role
 * rather than presenting one giant filterable grid:
 *
 *   1. Active Voting — amendments not yet enabled. This is the only
 *      thing actively changing on the page. Full cards with progress
 *      bars and (when data exists) sparklines.
 *
 *   2. Enabled History — already-activated amendments. Effectively
 *      tombstones; reference data. Compact one-line rows in a
 *      two-column grid on desktop, single column on mobile.
 *
 * Filter tabs are gone — the layout itself is the filter. Both
 * sections are visible at all times so users don't tab to find what
 * they want.
 */
export function AmendmentList({
  initialAmendments,
  sparklineMap,
}: AmendmentListProps) {
  const { active, enabled } = useMemo(() => {
    const active: AmendmentInfo[] = [];
    const enabled: AmendmentInfo[] = [];
    for (const a of initialAmendments) {
      if (a.enabled) enabled.push(a);
      else active.push(a);
    }
    // Active: has-majority first (closer to activation), then by % desc.
    active.sort((a, b) => {
      if (a.hasMajority !== b.hasMajority) return a.hasMajority ? -1 : 1;
      return b.majorityPercent - a.majorityPercent;
    });
    // Enabled: most recent first.
    enabled.sort((a, b) => {
      const ad = a.enabledAt ? new Date(a.enabledAt).getTime() : 0;
      const bd = b.enabledAt ? new Date(b.enabledAt).getTime() : 0;
      return bd - ad;
    });
    return { active, enabled };
  }, [initialAmendments]);

  return (
    <div className="space-y-8">
      {/* Active Voting */}
      <section>
        <SectionHeader
          title="Active voting"
          subtitle="Amendments still being voted on by validators"
          count={active.length}
        />
        {active.length === 0 ? (
          <div className="rounded-2xl bg-surface px-5 py-8 text-center shadow-card">
            <p className="font-mono text-cell text-muted">
              No amendments currently being voted on.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
            {active.map((amendment) => (
              <AmendmentCard
                key={amendment.hash}
                amendment={amendment}
                sparklineData={sparklineMap?.[amendment.hash]}
              />
            ))}
          </div>
        )}
      </section>

      {/* Enabled history */}
      <section>
        <SectionHeader
          title="Enabled history"
          subtitle="Activated amendments — most recent first"
          count={enabled.length}
        />
        {enabled.length === 0 ? (
          <div className="rounded-2xl bg-surface px-5 py-8 text-center shadow-card">
            <p className="font-mono text-cell text-muted">
              No amendments enabled yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
            <div className="grid lg:grid-cols-2 lg:[&>*:nth-child(odd)]:border-r lg:[&>*:nth-child(odd)]:border-elevated">
              {enabled.map((amendment) => (
                <EnabledAmendmentRow
                  key={amendment.hash}
                  amendment={amendment}
                />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle: string;
  count: number;
}

function SectionHeader({ title, subtitle, count }: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <div className="min-w-0">
        <h2 className="font-display text-label font-bold uppercase tracking-header text-brand">
          {title}{" "}
          <span className="ml-1 text-muted">({count})</span>
        </h2>
        <p className="mt-0.5 truncate font-mono text-tag text-muted">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

export default AmendmentList;
