"use client";

import { useId, type ReactNode } from "react";
import { motion } from "motion/react";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface ToggleOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface ToggleProps<T extends string> {
  options: ToggleOption<T>[];
  active: T;
  onChange: (value: T) => void;
  /** Override the active-item text color. Defaults to "text-brand". */
  accentClass?: string;
  /** ARIA label for the radio group. Screen readers announce this as the
   *  group's purpose ("Time period radio group", etc.). Optional for
   *  back-compat — the default `role="radiogroup"` still announces as a
   *  group, just without a name. New call sites should always pass it. */
  ariaLabel?: string;
}

/**
 * Universal toggle primitive. Pill-style button group with an animated
 * active background. Use anywhere the user picks exactly one option from
 * a small set (periods, filters, payment methods, view modes, etc.).
 *
 * This is the ONLY toggle component used on the site. All toggles should
 * route through this — not custom implementations.
 *
 * Semantics: `role="radiogroup"` wrapper + `role="radio"` items. Earlier
 * versions used `aria-pressed` which screen readers announce as N
 * independent toggle buttons rather than a single-select group.
 */
export default function Toggle<T extends string>({
  options,
  active,
  onChange,
  accentClass,
  ariaLabel,
}: ToggleProps<T>) {
  const id = useId();
  const activeColor = accentClass ?? "text-brand";

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex shrink-0 items-center rounded-full border border-elevated bg-elevated p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={active === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            // Token-driven height — matches every other interactive
            // control in the shared `--ctrl-h-*` system.
            "relative inline-flex min-h-[var(--ctrl-h-mobile)] items-center justify-center whitespace-nowrap rounded-full px-2.5 font-mono text-label font-medium uppercase tracking-pill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:min-h-[var(--ctrl-h-desktop)]",
            active === o.value ? activeColor : "text-muted hover:text-secondary"
          )}
        >
          {active === o.value && (
            <motion.div
              layoutId={`toggle-bg-${id}`}
              className="absolute inset-0 rounded-full bg-surface shadow-sm"
              transition={SPRING.layout}
            />
          )}
          <span className="relative z-10">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
