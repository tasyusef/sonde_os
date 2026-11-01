import { useEffect, useRef, type RefObject } from "react";

/**
 * Trap focus inside a modal/drawer/popover while it's open.
 *
 * - Moves initial focus to the first focusable descendant (or the
 *   container itself if none).
 * - Cycles focus on Tab / Shift+Tab so it can't escape the dialog.
 * - Restores focus to the previously-focused element on unmount.
 *
 * Pass `active=false` to no-op (e.g. when the dialog is closed but the
 * component is still mounted for an exit animation).
 */
export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] => {
      const nodes = container.querySelectorAll<HTMLElement>(
        'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]',
      );
      // tabindex="-1" drops roving-tabindex items (Toggle, tabs) that Tab
      // skips, so first/last match what Tab actually reaches.
      return Array.from(nodes).filter(
        (el) =>
          !el.hasAttribute("disabled") &&
          el.getAttribute("tabindex") !== "-1" &&
          el.offsetParent !== null,
      );
    };

    // Initial focus — first interactive element, falling back to the
    // container itself (made focusable temporarily via tabIndex=-1).
    const els = focusables();
    if (els.length > 0) {
      els[0].focus();
    } else {
      const prev = container.getAttribute("tabindex");
      container.setAttribute("tabindex", "-1");
      container.focus();
      if (prev === null) container.removeAttribute("tabindex");
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKey);
    return () => {
      container.removeEventListener("keydown", onKey);
      // Restore focus to whatever opened the dialog if it's still in
      // the DOM and focusable. Skip if focus was moved elsewhere
      // intentionally (e.g. user navigated to another route).
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return ref;
}
