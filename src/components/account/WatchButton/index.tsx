"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

/**
 * WatchButton — toggle a wallet in/out of the authenticated user's
 * watchlist, right from an account or smart-money detail page. Reduces
 * friction vs. the original flow (navigate to /portfolio → Tools →
 * Watchlist → paste address → Add).
 *
 * For unauthenticated users the button becomes a link to /sign-in. The
 * dashboard-side IntelligenceContext already falls back to sessionStorage
 * in that case, but doing the same here would silently diverge from the
 * persisted server-side watchlist — better to prompt sign-in once.
 */

interface WatchlistResponse {
  items: { watchedAddress: string; label: string | null }[];
}

async function watchlistFetcher(url: string): Promise<WatchlistResponse | null> {
  const res = await fetch(url);
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function WatchButton({
  address,
  className,
}: {
  address: string;
  className?: string;
}) {
  const { address: authAddress } = useAuth();
  const isAuthed = !!authAddress;

  const { data, mutate, isLoading } = useSWR<WatchlistResponse | null>(
    isAuthed ? "/api/intel/watchlist" : null,
    watchlistFetcher,
    { dedupingInterval: 30_000 },
  );

  const isWatched = !!data?.items.some((i) => i.watchedAddress === address);
  const [pending, setPending] = useState(false);

  const toggle = useCallback(async () => {
    if (pending || !isAuthed) return;
    setPending(true);

    // Optimistic update
    const prev = data?.items ?? [];
    const nextItems = isWatched
      ? prev.filter((i) => i.watchedAddress !== address)
      : [...prev, { watchedAddress: address, label: null }];
    mutate({ items: nextItems }, false);

    try {
      const res = await fetch("/api/intel/watchlist", {
        method: isWatched ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mutate();
    } catch {
      // Rollback on failure
      mutate({ items: prev }, false);
    } finally {
      setPending(false);
    }
  }, [pending, isAuthed, isWatched, address, data, mutate]);

  if (!isAuthed) {
    return (
      <Link
        href="/portfolio"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-elevated bg-elevated px-3 py-1.5 font-mono text-label font-medium uppercase tracking-pill text-muted transition-colors hover:text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
          className,
        )}
        aria-label="Sign in to watch this address"
      >
        <StarIcon filled={false} />
        Watch
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending || isLoading}
      aria-pressed={isWatched}
      aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-label font-medium uppercase tracking-pill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-60 disabled:cursor-not-allowed",
        isWatched
          ? "border-brand/30 bg-brand/10 text-brand hover:bg-brand/20"
          : "border-elevated bg-elevated text-muted hover:text-primary hover:bg-surface",
        className,
      )}
    >
      <StarIcon filled={isWatched} />
      {isWatched ? "Watching" : "Watch"}
    </button>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
