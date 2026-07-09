"use client";

import AddressLink from "@/components/shared/AddressLink";
import HashLink from "@/components/shared/HashLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import { formatDate } from "@/lib/xrpl-helpers";
import type { Activation } from "@/hooks/useAccountData";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";

const thClass =
  "px-4 py-row font-display text-label font-medium uppercase tracking-header text-muted";

/**
 * ActivationsList — table of accounts this address activated.
 *
 * Mobile (<sm): two columns
 *   - Activated Account (with date stacked beneath as text-tag muted)
 *   - Amount + tx hash stacked, right-aligned
 *
 * Desktop (sm+): four columns
 *   - Activated Account | Date | Amount | Transaction
 *
 * Layout uses `table-fixed` + `<colgroup>` so column widths are
 * predictable across both breakpoints. Same pattern as HoldingsList —
 * see CLAUDE.md "Tables" for the canonical mobile-first approach.
 */
export default function ActivationsList({
  activations,
}: {
  activations: Activation[];
}) {
  const { visible, hasMore, loadMore, showAll } = usePagination(
    activations.length,
    15,
  );
  const pageRows = activations.slice(0, visible);

  if (activations.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-body text-muted">
          No account activations found
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
        <table className="w-full table-fixed">
          <colgroup>
            {/* Activated account — takes the remaining width */}
            <col className="w-auto" />
            {/* Mobile: Amount + tx stack. Desktop: Date column. */}
            <col className="w-[40%] sm:w-[22%]" />
            {/* Amount — sm+ only */}
            <col className="hidden sm:table-column sm:w-[18%]" />
            {/* Tx — sm+ only */}
            <col className="hidden sm:table-column sm:w-[26%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-elevated">
              <th scope="col" className={`${thClass} text-left`}>
                Activated Account
              </th>
              <th
                scope="col"
                className={`${thClass} text-right sm:text-left`}
              >
                <span className="sm:hidden">Amount</span>
                <span className="hidden sm:inline">Date</span>
              </th>
              <th
                scope="col"
                className={`${thClass} hidden text-right sm:table-cell`}
              >
                Amount
              </th>
              <th
                scope="col"
                className={`${thClass} hidden text-left sm:table-cell`}
              >
                Transaction
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((act, i) => (
              <tr
                key={act.hash || i}
                className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
              >
                {/* Account — adds Date inline beneath on mobile only */}
                <td className="px-4 py-row">
                  <AddressLink address={act.activatedAddress} />
                  <span className="mt-0.5 block font-mono text-tag text-muted sm:hidden">
                    {act.date != null ? formatDate(act.date) : "—"}
                  </span>
                </td>
                {/* Mobile: Amount + Tx stacked, right-aligned.
                     Desktop: just Date, left-aligned. */}
                <td className="px-4 py-row text-right sm:text-left">
                  <span className="block sm:hidden">
                    <AmountDisplay drops={act.amount} />
                  </span>
                  <span className="mt-0.5 block font-mono text-tag sm:hidden">
                    <HashLink hash={act.hash} />
                  </span>
                  <span className="hidden font-mono text-cell text-secondary sm:inline">
                    {act.date != null ? formatDate(act.date) : "—"}
                  </span>
                </td>
                {/* Amount — sm+ only */}
                <td className="hidden px-4 py-row text-right sm:table-cell">
                  <AmountDisplay drops={act.amount} />
                </td>
                {/* Tx — sm+ only */}
                <td className="hidden px-4 py-row sm:table-cell">
                  <HashLink hash={act.hash} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && (
          <LoadMoreFooter
            visible={visible}
            total={activations.length}
            onLoadMore={loadMore}
            onShowAll={showAll}
            label="activations"
          />
        )}
      </div>
    </div>
  );
}
