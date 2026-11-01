import { useLocation } from "react-router";
import UnifiedSearch from "@/components/layout/Search/UnifiedSearch";

/**
 * Global top bar — desktop only. Hosts the unified search bar.
 *
 * Pins 12px below the viewport top while scrolling, on a band of the
 * page ground that runs the column's full width, so what scrolls under
 * it never shows above it or through the picker's dither. The band
 * reaches 12px up into the status strip's empty bottom, so at rest the
 * bar sits where it did. Not on the landing page (`/`), which is its
 * own search bar.
 */
export default function TopBar() {
  const { pathname } = useLocation();
  if (pathname === "/") return null;
  return (
    <div className="sticky top-0 z-30 -mt-3 hidden bg-black px-6 py-3 md:block">
      <UnifiedSearch variant="topbar" />
    </div>
  );
}
