import { useEffect, useRef } from "react";

/**
 * Tab title set in the browser once a page's data loads.
 *
 * React 19 puts each newly mounted `<title>` first in <head>, and
 * `document.title` reads the first one. React Router's `<Meta/>` keeps
 * one keyed `<title>` across navigations, but it can still mount after
 * ours (Fast Refresh remounts it), so keep ours in front.
 */
export default function PageTitle({ children }: { children: string }) {
  const ref = useRef<HTMLTitleElement>(null);

  useEffect(() => {
    const own = ref.current;
    const head = document.head;
    if (!own) return;
    const keepFirst = () => {
      const first = head.querySelector(":scope > title");
      if (first && first !== own && own.parentNode === head) head.insertBefore(own, first);
    };
    keepFirst();
    const observer = new MutationObserver(keepFirst);
    observer.observe(head, { childList: true });
    return () => observer.disconnect();
  }, []);

  return <title ref={ref}>{children}</title>;
}
