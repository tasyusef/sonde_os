"use client";

import { useEffect, useState } from "react";
import type { StatValue } from "@/types/intel";

/**
 * Single-value stat block. Used when a query returns one row × one column.
 *
 *   "How many active accounts last week?" → { count: 12450 }
 *   becomes:
 *
 *     ┌──────────────────────────┐
 *     │  ACTIVE ACCOUNTS         │
 *     │  12,450                  │
 *     └──────────────────────────┘
 *
 * Animates the value on first mount via a count-up tween. Respects
 * `prefers-reduced-motion` (snap to final value, no animation).
 */

const ANIMATION_MS = 700;

/** easeOutQuart — fast at first, gentle settle at the end. */
function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

/** Tween a numeric value from 0 → target on mount. Returns the
 *  current display value. Snaps to target when reduced-motion is on
 *  or when the value is non-finite. */
function useCountUp(target: number, durationMs = ANIMATION_MS): number {
  // Initialize-once via the function form so we never call setValue
  // synchronously inside the effect (that triggers cascading renders).
  // SSR returns `target`; client picks 0 as the animation starting
  // point unless reduced-motion is on. StatRenderer doesn't actually
  // SSR with real data (chat answers stream in client-side), so the
  // brief 0-then-tween isn't a hydration concern in practice.
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return target;
    if (!Number.isFinite(target)) return target;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return reduced ? target : 0;
  });

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return; // already at target via initializer
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(target * easeOutQuart(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}

function formatNumeric(n: number, format: StatValue["format"]): string {
  if (!Number.isFinite(n)) return "—";

  if (format === "drops") {
    const xrp = n / 1_000_000;
    return xrp.toLocaleString(undefined, { maximumFractionDigits: 6 }) + " XRP";
  }
  if (format === "percent") {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
  }
  // "number" — abbreviate large values (12,450 → 12.5K, 1,200,000 → 1.2M).
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000)
    return (
      (n / 1_000_000_000).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      }) + "B"
    );
  if (abs >= 1_000_000)
    return (
      (n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
      "M"
    );
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function StatRenderer({ stat }: { stat: StatValue }) {
  // Animate numeric values; raw strings render as-is.
  const isNumeric = stat.format !== "raw" && Number.isFinite(Number(stat.value));
  const target = isNumeric ? Number(stat.value) : NaN;
  const animated = useCountUp(target);
  const display = isNumeric
    ? formatNumeric(animated, stat.format)
    : String(stat.value);

  return (
    <div className="rounded-xl border border-elevated bg-bg/40 px-5 py-4">
      <p className="font-display text-tag uppercase tracking-header text-muted">
        {stat.label}
      </p>
      <p
        className="mt-1 font-display text-display font-bold tabular-nums text-primary sm:text-display-lg"
        // Reserve right edge of width on tween-update so the layout doesn't
        // shimmy when the tens/hundreds/thousands digits cross.
        aria-live="polite"
        aria-atomic="true"
      >
        {display}
      </p>
    </div>
  );
}
