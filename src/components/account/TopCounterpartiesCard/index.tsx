"use client";

import Link from "next/link";
import CollapsibleCard from "@/components/shared/CollapsibleCard";
import type { CounterpartyRow } from "@/lib/clickhouse-queries";
import { getKnownName } from "@/lib/known-addresses";

/**
 * Free-tier counterparties card. Shows the top-5 accounts this address
 * has interacted with most, by total `(account, counterparty, day)` tx
 * count from `mv_account_counterparty_daily`. Each row links to that
 * counterparty's account page.
 *
 * "Interactions" framing intentional, not "transactions" — the MV
 * source is fed by 4 views (vte from + to, dex taker + maker), so a
 * single payment between two accounts produces TWO MV rows. The count
 * here is edge traversals, not distinct events. Same shape as the
 * `/api/intel/counterparties` route consumes.
 *
 * Renders null when there are no counterparties — keeps the sidebar
 * tight for fresh / never-active accounts.
 */
interface Props {
  counterparties: CounterpartyRow[];
}

export default function TopCounterpartiesCard({ counterparties }: Props) {
  if (counterparties.length === 0) return null;

  return (
    <CollapsibleCard
      title="Frequent Counterparties"
      storageKey="counterparties"
    >
      <ol className="divide-y divide-elevated">
        {counterparties.map((cp, i) => {
          const knownName = getKnownName(cp.address);
          const truncated = `${cp.address.slice(0, 6)}…${cp.address.slice(-4)}`;
          return (
            <li key={cp.address} className="px-4 py-2.5">
              <Link
                href={`/account/${encodeURIComponent(cp.address)}`}
                className="flex items-center gap-3 rounded-tag focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                <span
                  className="shrink-0 font-mono text-label tabular-nums text-muted"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-cell text-brand">
                    {knownName ?? truncated}
                  </div>
                  {knownName && (
                    <div className="truncate font-mono text-tag text-muted">
                      {truncated}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="font-mono text-cell font-semibold tabular-nums text-primary">
                    {cp.txCount.toLocaleString()}
                  </span>
                  <span className="font-display text-tag uppercase tracking-header text-muted">
                    {cp.type === "payment" ? "Payment" : "DEX"}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </CollapsibleCard>
  );
}
