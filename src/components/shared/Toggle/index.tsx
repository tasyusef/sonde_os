import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { rovingIndex } from "@/lib/roving-index";

export interface ToggleOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface ToggleProps<T extends string> {
  options: ToggleOption<T>[];
  active: T;
  onChange: (value: T) => void;
  /** ARIA label for the radio group. Screen readers announce this as the
   *  group's purpose ("Time period radio group", etc.). Optional for
   *  back-compat — the default `role="radiogroup"` still announces as a
   *  group, just without a name. New call sites should always pass it. */
  ariaLabel?: string;
}

/**
 * Universal toggle primitive: a row of chips, the chosen one inverted
 * (a block of the text colour). Use anywhere the user picks exactly one
 * option from a small set (periods, filters, payment methods, view
 * modes, etc.).
 *
 * This is the ONLY toggle component used on the site. All toggles should
 * route through this — not custom implementations.
 *
 * Semantics: `role="radiogroup"` wrapper + `role="radio"` items. Earlier
 * versions used `aria-pressed` which screen readers announce as N
 * independent toggle buttons rather than a single-select group.
 *
 * Keyboard (APG radio group): the group is one Tab stop, on the checked
 * radio. Arrow keys (either axis) and Home/End move focus and select,
 * wrapping at the ends.
 */
export default function Toggle<T extends string>({
  options,
  active,
  onChange,
  ariaLabel,
}: ToggleProps<T>) {
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = options.findIndex((o) => o.value === active);
  // Nothing checked (stale `active`) still needs a way in.
  const tabStop = activeIndex === -1 ? 0 : activeIndex;

  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    const next = rovingIndex(e.key, index, options.length, {
      orientation: "both",
      wrap: true,
    });
    if (next === null) return;
    e.preventDefault();
    radioRefs.current[next]?.focus();
    if (next !== activeIndex) onChange(options[next].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex shrink-0 items-center gap-1"
    >
      {options.map((o, index) => (
        <button
          key={o.value}
          ref={(el) => {
            radioRefs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={active === o.value}
          tabIndex={index === tabStop ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          className={cn(
            // Token-driven height — matches every other interactive
            // control in the shared `--ctrl-h-*` system.
            "inline-flex min-h-[var(--ctrl-h-mobile)] items-center justify-center whitespace-nowrap px-2.5 font-display text-caps uppercase sm:min-h-[var(--ctrl-h-desktop)]",
            active === o.value
              ? "bg-primary text-black"
              : "text-muted hover:bg-dither-strong hover:text-primary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
