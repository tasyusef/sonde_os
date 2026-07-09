"use client";

import { useMemo } from "react";
import { useLiveData } from "@/hooks/useLiveData";

interface HistoryStatusProps {
  /** Latest ledger index of the historical data this view is rendering.
   *  Comes from the CH-backed initial render. `null` means no history
   *  was found for this account in CH (predates backfill or CH outage). */
  asOfLedger: number | null;
  /** Whether the live-state hook has finished hydrating. While hydrating,
   *  we show "loading live"; after, we show the gap (ledger lag) or "live". */
  liveReady: boolean;
}

/**
 * Compact "as of ledger N → live (current ledger M)" indicator. Used on
 * the account page to communicate that historical data was server-
 * rendered from CH (instant) and live state has been (or is being)
 * hydrated from rippled.
 *
 * `asOfLedger` is the most recent ledger involving THIS account in CH.
 * If the account has been quiet for a while, the gap between
 * `asOfLedger` and the live tip is just "this account hasn't transacted
 * recently" — NOT a system staleness signal. Earlier versions showed a
 * warn-tone "N ledgers behind history" message which read like an
 * outage; corrected 2026-05-04 to a neutral "last activity Xd ago"
 * recency hint. Real ingester-lag detection lives on the admin page.
 */
export default function HistoryStatus({ asOfLedger, liveReady }: HistoryStatusProps) {
  const live = useLiveData();
  const currentLedger = live.ledger?.ledger_index ?? null;

  const display = useMemo(() => {
    if (asOfLedger == null) {
      return liveReady
        ? { text: "Live", tone: "live" as const }
        : { text: "Loading…", tone: "muted" as const };
    }
    if (!liveReady) {
      return {
        text: `As of ledger ${asOfLedger.toLocaleString()} — hydrating…`,
        tone: "muted" as const,
      };
    }
    if (currentLedger && currentLedger > asOfLedger) {
      const gap = currentLedger - asOfLedger;
      // Within ~2 min of tip — the account has activity right now or
      // just had some, no recency note needed.
      if (gap <= 30) {
        return {
          text: `Live (ledger ${currentLedger.toLocaleString()})`,
          tone: "live" as const,
        };
      }
      // Otherwise the account has been quiet for a while. ~4s/ledger
      // is the XRPL nominal cadence; close enough for human-readable
      // recency. Live tone (not warn) — being quiet isn't a problem.
      return {
        text: `Live · last activity ${formatLedgerGapAsAge(gap)}`,
        tone: "live" as const,
      };
    }
    return {
      text: `Live (ledger ${(currentLedger ?? asOfLedger).toLocaleString()})`,
      tone: "live" as const,
    };
  }, [asOfLedger, liveReady, currentLedger]);

  const dotClass = display.tone === "live" ? "bg-success" : "bg-muted";

  return (
    <span
      className="inline-flex items-center gap-1.5 font-display text-tag uppercase tracking-header text-muted"
      title="Account history is read from Sonde's local index of the XRPL. Live state (balances, NFTs, offers) is fetched from rippled in parallel."
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass} ${display.tone === "live" ? "motion-safe:animate-pulse" : ""}`}
      />
      {display.text}
    </span>
  );
}

/** XRPL ledgers close every ~4s. Convert a ledger gap into a coarse
 *  human-readable age — used for "last activity Xd ago" on quiet
 *  accounts. Approximate; close enough for UI recency hints. */
function formatLedgerGapAsAge(gap: number): string {
  const seconds = gap * 4;
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 30 * 86_400) return `${Math.round(seconds / 86_400)}d ago`;
  if (seconds < 365 * 86_400) return `${Math.round(seconds / (30 * 86_400))}mo ago`;
  return `${Math.round(seconds / (365 * 86_400))}y ago`;
}
