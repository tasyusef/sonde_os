"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Sparkles } from "lucide-react";
import { EXAMPLE_QUESTIONS } from "@/lib/intel-schemas";

/**
 * Below-search-bar discoverability hint:
 *
 *   ✨  or ask:  "How much XRP was burned in fees today?"
 *
 * Cycles through EXAMPLE_QUESTIONS every 5s. Click → /asktheledger
 * with ?q= prefilled so the chat auto-submits.
 *
 * Cycle pauses on hover/focus for readability.
 */

const ROTATE_MS = 5000;

export default function OrAskHint() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || reduced) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % EXAMPLE_QUESTIONS.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, reduced]);

  const question = EXAMPLE_QUESTIONS[index];

  return (
    <div
      className="mt-4 flex items-center justify-center gap-2 text-center"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Sparkles size={14} className="shrink-0 text-brand" aria-hidden="true" />
      <span className="font-display text-label uppercase tracking-header text-muted">
        or ask
      </span>
      <span className="font-body text-cell text-muted">·</span>
      <Link
        href={`/asktheledger?q=${encodeURIComponent(question)}`}
        className="rounded-sm font-body text-cell text-secondary transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={index}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="inline-block"
          >
            “{question}”
          </motion.span>
        </AnimatePresence>
      </Link>
    </div>
  );
}
