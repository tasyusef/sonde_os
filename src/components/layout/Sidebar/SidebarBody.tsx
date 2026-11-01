import { type ReactNode } from "react";
import { navItems, watchlistItem, bottomNavItems, isNavActive } from "./nav-items";
import { NavLink } from "./NavLink";
import { RecentSearches } from "./RecentSearches";
import { ThemeRow } from "./ThemeRow";

/**
 * The sidebar's dither mat: the pages and recent searches, then docs,
 * support and the theme, with `foot` last. As in Toolbox, rows in a
 * group touch and groups sit 24px apart; the padding is the same on
 * every side. The desktop sidebar and the mobile menu both draw it.
 */
export function SidebarBody({ pathname, foot }: { pathname: string; foot?: ReactNode }) {
  return (
    // Scrolls only when a short window can't fit the recents too; never
    // sideways, while the desktop column eases between widths.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden bg-dither p-2.5">
      <div className="flex flex-1 flex-col gap-6">
        <nav aria-label="Main navigation" className="flex flex-col">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} isActive={isNavActive(item.href, pathname)} />
          ))}
          <NavLink item={watchlistItem} isActive={isNavActive(watchlistItem.href, pathname)} />
        </nav>
        <RecentSearches pathname={pathname} />
      </div>

      <div className="shrink-0 pt-6">
        {bottomNavItems.map((item) => (
          <NavLink key={item.href} item={item} isActive={isNavActive(item.href, pathname)} />
        ))}
        <ThemeRow />
        {foot}
      </div>
    </div>
  );
}
