import { useState } from "react";
import { useIntelligence } from "@/hooks/useIntelligence";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";
import AddressLink from "@/components/shared/AddressLink";
import Button from "@/components/shared/Button";
import ListNotice from "@/components/shared/ListNotice";
import PixelIcon from "@/components/shared/PixelIcon";
import Section from "@/components/shared/Section";
import { cell, thClass } from "@/lib/table";

/**
 * Add, label and remove saved accounts. The list lives in this browser
 * (`useIntelligence` → localStorage).
 *
 *   Mobile (<sm):  Account (+ label folded under) | remove
 *   sm+:           Account | Label | remove
 */
export default function WatchlistTab() {
  const { watchlist, watchlistItems, addToWatchlist, removeFromWatchlist, watchlistLoading } = useIntelligence();
  const [input, setInput] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!XRPL_ADDRESS_RE.test(trimmed)) {
      setError("Invalid XRPL address");
      return;
    }
    if (watchlist.includes(trimmed)) {
      setError("Already in watchlist");
      return;
    }
    addToWatchlist(trimmed, label);
    setInput("");
    setLabel("");
    setError(null);
  };

  return (
    <div className="space-y-16">
      <Section title="Add an account">
        <div className="flex items-start gap-2">
          <div className="flex-1 space-y-1.5">
            <input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="rAddress..."
              aria-label="Add account to watchlist"
              aria-invalid={error ? true : undefined}
              className={cn(
                "w-full border bg-surface px-3 py-2 font-mono text-cell text-primary placeholder:text-muted/50",
                error ? "border-error" : "border-line",
              )}
            />
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Label (optional)"
              aria-label="Address label"
              className="w-full border border-line bg-surface px-3 py-1.5 font-body text-cell text-primary placeholder:text-muted/50"
            />
            {error && (
              <p className="font-mono text-tag text-error" role="alert">{error}</p>
            )}
          </div>
          <Button onClick={handleAdd} variant="primary" size="md" className="shrink-0">
            Add
          </Button>
        </div>
      </Section>

      <Section title="Saved accounts" count={watchlistItems.length} note="Saved in this browser only.">
        {watchlistLoading ? null : watchlistItems.length === 0 ? (
          <ListNotice message="No saved accounts yet. Add one above, or press Watch on any account page." />
        ) : (
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-auto" />
              <col className="hidden sm:table-column sm:w-[40%]" />
              <col className="w-14" />
            </colgroup>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={`${thClass} text-left`}>Account</th>
                <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>Label</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {watchlistItems.map((item) => (
                <tr key={item.watchedAddress} className="border-b border-line last:border-b-0">
                  <td className={`${cell} align-middle`}>
                    <AddressLink address={item.watchedAddress} />
                    {item.label && (
                      <span className="mt-0.5 block truncate font-body text-tag text-muted sm:hidden">
                        {item.label}
                      </span>
                    )}
                  </td>
                  <td className={`${cell} hidden truncate align-middle font-body text-cell text-primary sm:table-cell`}>
                    {item.label ?? <span className="text-muted">—</span>}
                  </td>
                  <td className={`${cell} text-right align-middle`}>
                    <Button
                      onClick={() => removeFromWatchlist(item.watchedAddress)}
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label={`Remove ${item.label ?? item.watchedAddress} from watchlist`}
                      className="hover:text-error hover:bg-error/10"
                    >
                      <PixelIcon name="close" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
