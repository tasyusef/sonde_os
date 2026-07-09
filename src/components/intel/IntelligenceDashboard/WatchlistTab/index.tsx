"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useIntelligence } from "@/components/intel/IntelligenceContext";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";
import Button from "@/components/shared/Button";

const FREE_TIER_LIMIT = 3;

interface AddressStatus {
  address: string;
  lastActive: string | null;
  riskLevel: "low" | "medium" | "high" | "unknown";
  txCount24h: number;
}

function riskColor(level: string) {
  switch (level) {
    case "high": return "bg-error/10 text-error";
    case "medium": return "bg-chart-amber/10 text-chart-amber";
    case "low": return "bg-success/10 text-success";
    default: return "bg-elevated text-muted";
  }
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "No activity";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function WatchlistTab() {
  const { watchlist, watchlistItems, addToWatchlist, removeFromWatchlist, watchlistLoading } = useIntelligence();
  const { address: authAddress } = useAuth();
  const { tier } = useSubscription();
  const [input, setInput] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isPro = tier === "pro";
  const isAuthenticated = !!authAddress;
  const slotsUsed = watchlist.length;
  const showLimit = isAuthenticated && !isPro;

  // Fetch statuses for all watchlist addresses
  const { data: statusData } = useSWR<{ statuses: AddressStatus[] }>(
    watchlist.length > 0 && isAuthenticated ? ["watchlist-status", ...watchlist] : null,
    async () => {
      const res = await fetch("/api/intel/watchlist-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: watchlist }),
      });
      if (!res.ok) return { statuses: [] };
      return res.json();
    },
    { refreshInterval: 120_000, dedupingInterval: 30_000 },
  );

  const statusMap = new Map<string, AddressStatus>();
  if (statusData?.statuses) {
    for (const s of statusData.statuses) statusMap.set(s.address, s);
  }

  const handleAdd = useCallback(() => {
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
    if (showLimit && slotsUsed >= FREE_TIER_LIMIT) {
      setError(`Free tier limited to ${FREE_TIER_LIMIT} addresses`);
      return;
    }
    addToWatchlist(trimmed, label.trim() || undefined);
    setInput("");
    setLabel("");
    setError(null);
  }, [input, label, watchlist, addToWatchlist, showLimit, slotsUsed]);

  return (
    <div className="space-y-4">
      {/* Free tier limit indicator */}
      {showLimit && (
        <div className="flex items-center justify-between rounded-lg bg-elevated px-3 py-2">
          <span className="font-mono text-label text-muted">
            {slotsUsed}/{FREE_TIER_LIMIT} slots used
          </span>
          <Link
            href="/pricing"
            className="font-mono text-label text-brand hover:underline"
          >
            Upgrade for unlimited
          </Link>
        </div>
      )}

      {/* Add address */}
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="rAddress..."
            aria-label="Add account to watchlist"
            className={cn(
              "w-full rounded-lg border bg-elevated px-3 py-2 font-mono text-cell text-primary placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
              error ? "border-error" : "border-elevated",
            )}
          />
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            aria-label="Address label"
            className="w-full rounded-lg border border-elevated bg-elevated px-3 py-1.5 font-body text-cell text-primary placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          />
          {error && (
            <p className="font-mono text-tag text-error" role="alert">{error}</p>
          )}
        </div>
        <Button
          onClick={handleAdd}
          disabled={showLimit && slotsUsed >= FREE_TIER_LIMIT}
          variant="primary"
          size="md"
          className="shrink-0"
        >
          Add
        </Button>
      </div>

      {/* Watchlist table */}
      {watchlistLoading ? (
        <div className="py-8 text-center">
          <span className="h-2 w-2 motion-safe:animate-pulse rounded-full bg-brand inline-block" />
          <span className="ml-2 font-mono text-cell text-muted">Loading watchlist...</span>
        </div>
      ) : watchlist.length === 0 ? (
        <p className="py-8 text-center font-mono text-cell text-muted">
          {isAuthenticated
            ? "Add accounts to your watchlist to monitor them."
            : "Sign in to save your watchlist across sessions."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-elevated">
          <table className="w-full">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-display text-label font-medium uppercase tracking-header text-muted">
                  Account
                </th>
                {isAuthenticated && (
                  <>
                    <th scope="col" className="px-4 py-2.5 text-left font-display text-label font-medium uppercase tracking-header text-muted">
                      Last Active
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-left font-display text-label font-medium uppercase tracking-header text-muted">
                      24h TX
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-left font-display text-label font-medium uppercase tracking-header text-muted">
                      Risk
                    </th>
                  </>
                )}
                <th scope="col" className="w-12">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {watchlistItems.map((item) => {
                const status = statusMap.get(item.watchedAddress);
                return (
                  <tr key={item.watchedAddress} className="border-b border-elevated last:border-b-0">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/account/${item.watchedAddress}`}
                        className="font-mono text-cell text-brand hover:underline"
                      >
                        {item.watchedAddress.slice(0, 8)}...{item.watchedAddress.slice(-4)}
                      </Link>
                      {item.label && (
                        <span className="ml-2 font-body text-tag text-muted">{item.label}</span>
                      )}
                    </td>
                    {isAuthenticated && (
                      <>
                        <td className="px-4 py-2.5 font-mono text-cell text-muted">
                          {status ? timeAgo(status.lastActive) : "—"}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-cell text-primary">
                          {status?.txCount24h ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {status ? (
                            <span className={cn("rounded-full px-2 py-0.5 font-mono text-label font-semibold", riskColor(status.riskLevel))}>
                              {status.riskLevel}
                            </span>
                          ) : (
                            <span className="font-mono text-cell text-muted">—</span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        onClick={() => removeFromWatchlist(item.watchedAddress)}
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label={`Remove ${item.watchedAddress.slice(0, 8)} from watchlist`}
                        className="hover:text-error hover:bg-error/10"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
