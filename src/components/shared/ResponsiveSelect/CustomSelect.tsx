import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { slideDownVariants, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ResponsiveSelectOption } from "./index";
import SelectOption from "./SelectOption";
import { useListboxKeys } from "./useListboxKeys";
import PixelIcon from "@/components/shared/PixelIcon";

/** Dither trigger + a panel that drops in from it. Caps labels match
 *  Toggle and the tab strip so headers stay unified. Keyboard model
 *  lives in `useListboxKeys`. */
export default function CustomSelect<T extends string>({
  options,
  active,
  onChange,
  ariaLabel,
  className,
  triggerClassName,
}: {
  options: ResponsiveSelectOption<T>[];
  active: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
}) {
  // Panel alignment is contextual — it always biases toward the center
  // of the viewport, so a trigger on the left edge extends RIGHTWARD
  // (instead of pushing the panel into the screen edge), and a trigger
  // on the right extends LEFTWARD. Measured synchronously in the opening
  // event before `open` flips, so the panel renders with the correct
  // alignment on the very first frame — no flicker.
  const [alignment, setAlignment] = useState<"left" | "right">("left");
  const selectedIndex = options.findIndex((o) => o.value === active);
  const { open, close, containerRef, triggerProps, getOptionProps } =
    useListboxKeys({
      count: options.length,
      selectedIndex,
      onBeforeOpen: (trigger) => {
        const rect = trigger.getBoundingClientRect();
        const triggerCenterX = rect.left + rect.width / 2;
        setAlignment(triggerCenterX > window.innerWidth / 2 ? "right" : "left");
      },
    });

  const activeLabel = options[selectedIndex]?.label ?? "";

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block", className)}
    >
      {/* The name keeps the visible value ("Search type: Account"):
           an `aria-label` replaces the button text, and WCAG 2.5.3
           wants what's shown to be part of what's announced. */}
      <button
        {...triggerProps}
        type="button"
        aria-label={ariaLabel ? `${ariaLabel}: ${activeLabel}` : undefined}
        className={cn(
          "inline-flex min-h-[var(--ctrl-h-mobile)] items-center gap-1.5 bg-dither px-3 font-display text-caps uppercase text-primary hover:bg-primary hover:text-black sm:min-h-[var(--ctrl-h-desktop)]",
          triggerClassName,
        )}
      >
        <span>{activeLabel}</span>
        <PixelIcon
          name={open ? "chevron-up" : "chevron-down"}
          size="sm"
          className="shrink-0"
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={ariaLabel}
            variants={slideDownVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={SPRING.pop}
            className={cn(
              "absolute top-full z-50 mt-1.5 min-w-[160px] overflow-hidden bg-surface py-1 shadow-card",
              alignment === "right" ? "right-0" : "left-0",
            )}
          >
            {options.map((o, i) => (
              <SelectOption
                key={o.value}
                label={o.label}
                selected={o.value === active}
                listboxProps={getOptionProps(i)}
                onSelect={() => {
                  onChange(o.value);
                  close();
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
