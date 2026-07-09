import UnifiedSearch from "@/components/layout/Search/UnifiedSearch";

/**
 * Global top bar — desktop only. Hosts the unified search bar.
 *
 * Sticky at `top-3` so it pins 12px from the viewport top while
 * scrolling — matches the floating sidebar's `top-3` so they sit at
 * the same vertical baseline.
 */
export default function TopBar() {
  return (
    <div className="sticky top-3 z-30 mb-3 mr-3 hidden md:block">
      <UnifiedSearch variant="topbar" />
    </div>
  );
}
