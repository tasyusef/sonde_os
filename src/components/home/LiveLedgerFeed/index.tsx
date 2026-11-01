import { useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import Section from "@/components/shared/Section";
import { useLiveData } from "@/hooks/useLiveData";
import { fadeVariants, SPRING } from "@/lib/motion";
import LedgerCard from "./LedgerCard";

const MAX_LEDGERS = 20;

/**
 * Live ledger strip for the network page: the newest validated ledgers
 * from `useLiveData`, newest first, in a row that scrolls sideways,
 * columns split by hairlines. See `LedgerCard` for one column.
 */
export default function LiveLedgerFeed({ className }: { className?: string }) {
  const { ledgerHistory, connected } = useLiveData();
  const ledgers = useMemo(() => [...ledgerHistory].reverse().slice(0, MAX_LEDGERS), [ledgerHistory]);

  return (
    <Section
      title="Latest ledgers"
      status={ledgers.length > 0 ? null : connected ? "Waiting for ledger closes…" : "Connecting to the live feed…"}
      className={className}
    >
      {/* aria-live="polite" hints at each new ledger without reading the
           whole strip again; atomic=false scopes it to what changed. The
           1-cell inset keeps focus rings clear of the scroll clip. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="scrollbar-brand -m-1 flex overflow-x-auto p-1 pb-3"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {ledgers.map((l) => (
            <motion.div
              key={l.ledger_index}
              // New ledgers fade in at full size: no scale or blur on
              // text.
              variants={fadeVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={SPRING.smooth}
              className="shrink-0 border-l border-line px-4 first:border-l-0 first:pl-0"
            >
              <LedgerCard
                ledgerIndex={l.ledger_index}
                ledgerTime={l.ledger_time}
                txnCount={l.txn_count}
                txSummaries={l.txSummaries}
                totalFees={l.totalFees}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Section>
  );
}
