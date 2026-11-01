import { type ReactNode } from "react";
import PixelIcon from "@/components/shared/PixelIcon";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/** Explorer — primary public pages.
 *
 * No "Home" / "Landing" entry on purpose. The landing page lives at
 * `/` and is the marketing surface — the sidebar nav is for the
 * data-rich app pages users actually work in. The Sonde logo at the
 * top of the sidebar (and in the mobile header) is the affordance
 * back to the landing. */
export const navItems: NavItem[] = [
  {
    href: "/network",
    label: "Network",
    icon: <PixelIcon name="network" />,
  },
];

/** Watchlist — accounts saved in this browser */
export const watchlistItem: NavItem = {
  href: "/watchlist",
  label: "Watchlist",
  icon: <PixelIcon name="star" />,
};

/** Bottom section — docs, support. */
export const bottomNavItems: NavItem[] = [
  {
    href: "/docs",
    label: "Docs",
    icon: <PixelIcon name="book" />,
  },
  {
    href: "/support",
    label: "Support",
    icon: <PixelIcon name="help" />,
  },
];

export function isNavActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}
