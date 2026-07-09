import Link from "next/link";
import { cn } from "@/lib/utils";
import { type NavItem } from "./nav-items";

export function NavLink({
  item,
  isActive,
  onClick,
  className,
  iconRight,
}: {
  item: NavItem;
  isActive: boolean;
  onClick?: () => void;
  className?: string;
  /** Place icon on the right and right-align text (mobile menu) */
  iconRight?: boolean;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-3 rounded-xl font-display text-ui font-medium tracking-nav transition-all duration-200 hover:scale-[1.04] active:scale-[0.97]",
        iconRight ? "flex-row-reverse pl-3" : "pr-3",
        isActive
          ? "bg-brand/10 text-brand"
          : "text-muted hover:bg-row-hover hover:text-primary",
        className
      )}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center", isActive ? "text-brand" : "text-muted")}>
        {item.icon}
      </span>
      <span className={cn("whitespace-nowrap", iconRight && "ml-auto")}>
        {item.label}
      </span>
    </Link>
  );
}
