import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { rovingIndex } from "@/lib/roving-index";

/** Props `getOptionProps(i)` returns for each option element. */
export interface ListboxOptionProps {
  ref: (el: HTMLElement | null) => void;
  tabIndex: number;
  onKeyDown: (e: KeyboardEvent) => void;
}

/** Option that takes focus when the list opens: the selected one, else
 *  the first, or the last when opened with ArrowUp. */
export function openFocusIndex(
  key: string,
  selectedIndex: number,
  count: number,
): number {
  if (selectedIndex >= 0 && selectedIndex < count) return selectedIndex;
  return key === "ArrowUp" ? count - 1 : 0;
}

/**
 * Open state + keyboard model for a button that pops up a listbox
 * (ResponsiveSelect's dropdown, Tabs' "More" menu), per the APG listbox:
 *
 * - ArrowDown/ArrowUp on the trigger open the list. Opening (by key or
 *   click) focuses the selected option.
 * - In the list, ArrowUp/ArrowDown/Home/End move focus (no wrap).
 *   Options are buttons, so Enter/Space fire the caller's `onClick`.
 * - Escape closes and returns focus to the trigger, and goes no further,
 *   so an enclosing dialog (the mobile search overlay) stays open.
 * - Options are `tabIndex={-1}`: Tab leaves the widget and closes it.
 * - Outside click closes without moving focus.
 *
 * Spread `triggerProps` on the trigger and `getOptionProps(i)` on each
 * option; put `containerRef` on the element wrapping both.
 */
export function useListboxKeys({
  count,
  selectedIndex,
  onBeforeOpen,
}: {
  count: number;
  /** -1 when no option is selected. */
  selectedIndex: number;
  /** Runs in the opening event, before the list renders (e.g. to measure
   *  the trigger for panel alignment). */
  onBeforeOpen?: (trigger: HTMLButtonElement) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLElement | null)[]>([]);
  const focusOnOpen = useRef(0);

  const openList = (key: string) => {
    if (triggerRef.current) onBeforeOpen?.(triggerRef.current);
    focusOnOpen.current = openFocusIndex(key, selectedIndex, count);
    setOpen(true);
  };

  /** `returnFocus: false` when the caller moves focus itself. */
  const close = ({ returnFocus = true }: { returnFocus?: boolean } = {}) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // The App Router hydrates on `document`, so React's handlers run in a
  // listener on `document` itself: `stopPropagation` alone wouldn't keep
  // other `document` keydown listeners (SearchFab's close) from firing.
  const closeOnEscape = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    close();
  };

  // The list mounts on the same commit `open` flips, so its refs are set.
  useEffect(() => {
    if (open) optionRefs.current[focusOnOpen.current]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Fallback for when focus has left the widget (e.g. a click on the
    // panel's padding); in-widget Escape is handled, and stopped, below.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const triggerProps = {
    ref: triggerRef,
    "aria-haspopup": "listbox" as const,
    "aria-expanded": open,
    onClick: () => (open ? close() : openList("Enter")),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!open) openList(e.key);
        else optionRefs.current[openFocusIndex(e.key, selectedIndex, count)]?.focus();
      } else if (e.key === "Escape" && open) {
        closeOnEscape(e);
      } else if (e.key === "Tab") {
        setOpen(false);
      }
    },
  };

  const getOptionProps = (index: number): ListboxOptionProps => ({
    ref: (el: HTMLElement | null) => {
      optionRefs.current[index] = el;
    },
    tabIndex: -1,
    onKeyDown: (e: KeyboardEvent) => {
      const next = rovingIndex(e.key, index, count, {
        orientation: "vertical",
        wrap: false,
      });
      if (next !== null) {
        e.preventDefault();
        optionRefs.current[next]?.focus();
      } else if (e.key === "Escape") {
        closeOnEscape(e);
      } else if (e.key === "Tab") {
        setOpen(false);
      }
    },
  });

  return { open, close, containerRef, triggerProps, getOptionProps };
}
