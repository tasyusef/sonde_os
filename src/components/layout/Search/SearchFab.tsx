import { useCallback, useState } from "react";
import { useLocation } from "react-router";
import MobileSheet from "@/components/layout/MobileSheet";
import PixelIcon from "@/components/shared/PixelIcon";
import UnifiedSearch from "./UnifiedSearch";

/**
 * Mobile search: the accent block at the bottom right of every page
 * (`bottom-[var(--fab-search-bottom)] right-4`), flat like the
 * primary button it is. It opens the search as a sheet rising from the
 * bottom, with the close in its place and the field beside it. Not on
 * the landing page (`/`), which is its own search bar.
 */
export default function SearchFab() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Close on route change — user just navigated, no point keeping the
  // sheet open. Uses the "derived from prop" pattern (compare prev
  // pathname during render) instead of `useEffect(setOpen)` so it
  // satisfies `react-hooks/set-state-in-effect`.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (open) setOpen(false);
  }

  if (pathname === "/") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open search"
        aria-expanded={open}
        className="fixed bottom-[var(--fab-search-bottom)] right-4 z-30 flex h-12 w-12 items-center justify-center bg-accent text-on-accent hover:bg-primary hover:text-black md:hidden"
      >
        <PixelIcon name="search" />
      </button>

      <MobileSheet open={open} onClose={close} label="Search" closeLabel="Close search" from="bottom">
        <UnifiedSearch variant="overlay" autoFocus onSubmit={close} />
      </MobileSheet>
    </>
  );
}
