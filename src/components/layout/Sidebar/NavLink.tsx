import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { type NavItem } from "./nav-items";

/** Row states shared by the sidebar and the mobile drawer: hover and
 *  focus invert the row, and the current page is the accent block. */
export function navRowClass(isActive: boolean) {
  return isActive
    ? "bg-accent text-on-accent"
    : "text-primary hover:bg-primary hover:text-black";
}

export function NavLink({
  item,
  isActive,
  onClick,
  className,
}: {
  item: NavItem;
  isActive: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Link
      to={item.href}
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-3 pr-3 font-display text-caps uppercase md:rail:pr-0",
        navRowClass(isActive),
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">{item.icon}</span>
      <span className="whitespace-nowrap md:rail:sr-only">{item.label}</span>
    </Link>
  );
}
