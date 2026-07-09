"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { useLiveData } from "@/hooks/useLiveData";
import { cn } from "@/lib/utils";
import LedgerCard from "./LedgerCard";

const MAX_DISPLAY_LEDGERS_VERTICAL = 5;
const MAX_DISPLAY_LEDGERS_HORIZONTAL = 20;

/* ------------------------------------------------------------------ */
/*  Main Feed                                                          */
/* ------------------------------------------------------------------ */

interface LiveLedgerFeedProps {
  horizontal?: boolean;
}

/**
 * Live ledger ticker for the Network Overview / homepage. Ledgers
 * stream in via the `useLiveData` WS singleton and render as a
 * horizontal (or vertical) row of LedgerCards. Each card is a
 * fixed-height tile with a proportional tx-family bar — see
 * `LedgerCard` for the why behind dropping the per-tx dot grid.
 */
export default function LiveLedgerFeed({ horizontal = false }: LiveLedgerFeedProps) {
  const { ledgerHistory, connected } = useLiveData();

  // Newest-first, capped
  const maxLedgers = horizontal ? MAX_DISPLAY_LEDGERS_HORIZONTAL : MAX_DISPLAY_LEDGERS_VERTICAL;
  const ledgers = useMemo(
    () => [...ledgerHistory].reverse().slice(0, maxLedgers),
    [ledgerHistory, maxLedgers],
  );

  return (
    <div className="flex flex-col gap-0 overflow-hidden rounded-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connected ? "bg-success animate-pulse" : "bg-error",
            )}
          />
          <span className="font-display text-label font-medium uppercase tracking-header text-muted">
            Latest Ledgers
          </span>
        </div>
        <Link
          href="/ledger/validated"
          className="rounded-lg font-display text-label font-bold uppercase tracking-header text-brand transition-colors hover:text-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          View All
        </Link>
      </div>

      {/* Cards. aria-live="polite" so screen-reader users get a hint
           when ledgers tick over without spamming on every update; the
           body itself is mostly numbers/links so atomic=false keeps
           announcements scoped to changed regions. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className={cn(
          horizontal
            ? "scrollbar-brand flex flex-row gap-3 overflow-x-scroll pb-2"
            : "flex flex-col gap-2.5",
        )}
      >
        {ledgers.length === 0 ? (
          <div
            className={cn(
              "rounded-xl border border-elevated bg-surface px-4 py-8 text-center shadow-card",
              horizontal && "w-full shrink-0",
            )}
          >
            <p className="font-mono text-body text-muted">
              Waiting for ledger closes...
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {ledgers.map((l) => (
              <motion.div
                key={l.ledger_index}
                initial={
                  horizontal
                    ? { opacity: 0, scale: 0.95, filter: "blur(4px)" }
                    : { opacity: 0, scale: 0.97, filter: "blur(4px)" }
                }
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
                transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ willChange: "transform, opacity, filter" }}
              >
                <LedgerCard
                  ledgerIndex={l.ledger_index}
                  ledgerTime={l.ledger_time}
                  txnCount={l.txn_count}
                  txSummaries={l.txSummaries}
                  totalFees={l.totalFees}
                  horizontal={horizontal}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
