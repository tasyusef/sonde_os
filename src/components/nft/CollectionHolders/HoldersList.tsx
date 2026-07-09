"use client";

import { useState } from "react";
import AddressLink from "@/components/shared/AddressLink";
import Button from "@/components/shared/Button";
import CollapsibleCard from "@/components/shared/CollapsibleCard";
import { type CollectionHolderRow } from "@/lib/db-queries";

const INITIAL_COUNT = 5;

/**
 * Top holders, rendered inside a `CollapsibleCard` (so the entire
 * section can be hidden behind the header chevron) with an internal
 * 5/15 expand button below the rows for revealing the long tail.
 *
 * Two collapse interactions, intentionally distinct:
 *   - Card-level chevron (handled by `CollapsibleCard`) — hides the
 *     entire body. Persisted in localStorage per the card's
 *     storageKey.
 *   - "Show more / Show less" button at the bottom of the visible
 *     body — toggles between the top 5 holders and the full 15.
 *
 * The scroll-cap-at-5-rows pattern was dropped: a card-in-card scroll
 * inside the Insights sidebar was an awkward interaction (mouse
 * wheel kept catching the wrong scroll context). The expand button
 * is more explicit + accessible.
 */
export default function HoldersList({
  holders,
}: {
  holders: CollectionHolderRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = holders.length > INITIAL_COUNT;
  const topCount = holders[0]?.count ?? 1;
  const visible = expanded ? holders : holders.slice(0, INITIAL_COUNT);

  return (
    <CollapsibleCard title="Top Holders" storageKey="collection-top-holders">
      <div
        role="row"
        className="grid h-9 grid-cols-[24px_1fr_auto] items-center gap-3 px-4"
      >
        <span className="font-display text-tag font-medium uppercase tracking-header text-muted">
          #
        </span>
        <span className="font-display text-tag font-medium uppercase tracking-header text-muted">
          Holder
        </span>
        <span className="text-right font-display text-tag font-medium uppercase tracking-header text-muted">
          Items
        </span>
      </div>
      <ul className="divide-y divide-elevated">
        {visible.map((h, i) => {
          const pct = topCount > 0 ? (h.count / topCount) * 100 : 0;
          return (
            <li
              key={h.address}
              className="relative grid h-[52px] grid-cols-[24px_1fr_auto] items-center gap-3 px-4"
            >
              {/* Background bar — proportional to the top holder's
                  count. Subtle, sits behind the row content. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 z-0 bg-brand/5"
                style={{ width: `${pct}%` }}
              />
              <span className="relative z-10 font-mono text-tag tabular-nums text-muted">
                {i + 1}
              </span>
              <div className="relative z-10 min-w-0">
                <AddressLink address={h.address} />
              </div>
              <span className="relative z-10 font-mono text-cell tabular-nums text-primary">
                {h.count.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div className="border-t border-elevated p-3">
          <Button
            variant="outline"
            onClick={() => setExpanded((v) => !v)}
            className="w-full"
          >
            {expanded ? "Show less" : `Show ${holders.length - INITIAL_COUNT} more`}
          </Button>
        </div>
      )}
    </CollapsibleCard>
  );
}
