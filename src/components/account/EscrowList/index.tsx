import AddressLink from "@/components/shared/AddressLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import { formatDate } from "@/lib/xrpl-helpers";

export interface Escrow {
  Account: string;
  Destination: string;
  Amount: string;
  Condition?: string;
  CancelAfter?: number;
  FinishAfter?: number;
  PreviousTxnID: string;
}

export default function EscrowList({ escrows }: { escrows: Escrow[] }) {
  if (escrows.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">No escrows found</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
              From
            </th>
            <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
              Destination
            </th>
            <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
              Amount
            </th>
            <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
              Condition
            </th>
            <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
              Expiry
            </th>
          </tr>
        </thead>
        <tbody>
          {escrows.map((escrow, i) => (
            <tr
              key={escrow.PreviousTxnID || i}
              className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
            >
              <td className="px-4 py-row">
                <AddressLink address={escrow.Account} />
              </td>
              <td className="px-4 py-row">
                <AddressLink address={escrow.Destination} />
              </td>
              <td className="px-4 py-row text-right">
                <AmountDisplay drops={escrow.Amount} />
              </td>
              <td className="px-4 py-row font-mono text-cell text-secondary">
                {escrow.Condition ? "Yes" : "No"}
              </td>
              <td className="px-4 py-row font-mono text-cell text-secondary">
                {escrow.CancelAfter
                  ? formatDate(escrow.CancelAfter)
                  : escrow.FinishAfter
                    ? formatDate(escrow.FinishAfter)
                    : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
