import AddressLink from "@/components/shared/AddressLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import { formatDate } from "@/lib/xrpl-helpers";

export interface Channel {
  Account: string;
  Destination: string;
  Amount: string;
  Balance: string;
  Expiration?: number;
  CancelAfter?: number;
  SettleDelay: number;
  PreviousTxnID: string;
}

export default function ChannelList({ channels }: { channels: Channel[] }) {
  if (channels.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">No payment channels found</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
              Destination
            </th>
            <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
              Amount
            </th>
            <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
              Balance
            </th>
            <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
              Settle Delay
            </th>
            <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
              Expiry
            </th>
          </tr>
        </thead>
        <tbody>
          {channels.map((ch, i) => (
            <tr
              key={ch.PreviousTxnID || i}
              className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
            >
              <td className="px-4 py-row">
                <AddressLink address={ch.Destination} />
              </td>
              <td className="px-4 py-row text-right">
                <AmountDisplay drops={ch.Amount} />
              </td>
              <td className="px-4 py-row text-right">
                <AmountDisplay drops={ch.Balance} />
              </td>
              <td className="px-4 py-row text-right font-mono text-cell text-secondary tabular-nums">
                {ch.SettleDelay.toLocaleString()}s
              </td>
              <td className="px-4 py-row font-mono text-cell text-secondary">
                {ch.Expiration
                  ? formatDate(ch.Expiration)
                  : ch.CancelAfter
                    ? formatDate(ch.CancelAfter)
                    : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
