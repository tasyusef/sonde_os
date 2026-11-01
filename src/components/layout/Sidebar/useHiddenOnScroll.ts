import { useEffect, useState, type RefObject } from "react";

/**
 * Whether a fixed header should step out of the way: hidden while the
 * page scrolls down past it, back on any scroll up or near the top.
 * It stays while keyboard focus is in it, so tabbing through it never
 * hides what's focused.
 */
export function useHiddenOnScroll(ref: RefObject<HTMLElement | null>) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const header = ref.current;
      if (y <= (header?.offsetHeight ?? 0) || y < last) setHidden(false);
      else if (y > last && !header?.querySelector(":focus-visible")) setHidden(true);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ref]);

  return hidden;
}
