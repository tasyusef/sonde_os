"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Shield } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { SondeMark, SondeWordmark } from "@/components/shared/SondeLogo";
// `researchItem` is intentionally not imported — Research is temporarily
// offline (2026-05-02, until further notice). The export remains in
// nav-items.tsx for easy restoration; just re-add it here + below.
import { navItems, askItem, dashboardItem, smartMoneyItem, bottomNavItems } from "./nav-items";
import { NavLink } from "./NavLink";
import SettingsPanel from "@/components/intel/SettingsPanel";
import TierBadge from "@/components/subscription/TierBadge";
import Button from "@/components/shared/Button";
import { useAuth } from "@/hooks/useAuth";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_SONDE_TREASURY_ADDRESS;
const adminItem = { href: "/admin", label: "Admin", icon: <Shield size={20} /> };

function isNavActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const { address } = useAuth();
  const isAdmin = !!TREASURY_ADDRESS && address === TREASURY_ADDRESS;
  const asideRef = useRef<HTMLElement>(null);

  // Collapse the sidebar after navigation. When a user clicks a NavLink
  // the focus stays on the link, and the sidebar's `focus-within:w-[200px]`
  // rule keeps it expanded even after they move the cursor away. Blurring
  // the focused element on path change clears `focus-within` so the
  // sidebar collapses normally once the mouse leaves.
  useEffect(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      asideRef.current?.contains(active)
    ) {
      active.blur();
    }
  }, [pathname]);

  return (
    <>
      {/* Desktop Sidebar
          Collapsed: w-12 (48px). Nav pad 6px + link 36px = 42px. Text at 54px > 48px = clipped.
          Highlight is 36×36 = square. Expands to 200px on hover. */}
      <aside
        ref={asideRef}
        aria-label="Sidebar"
        className="fixed left-3 top-3 bottom-3 z-40 hidden w-12 flex-col overflow-hidden rounded-2xl shadow-card bg-surface transition-[width] duration-300 ease-in-out hover:w-[200px] focus-within:w-[200px] md:flex"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-1.5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center">
              <SondeMark size={20} className="text-brand" />
            </span>
            <SondeWordmark
              height={16}
              className="shrink-0 text-primary"
              staggerDelay={expanded ? 50 : undefined}
              baseDelay={100}
            />
          </Link>
          <span className="mr-2"><TierBadge /></span>
        </div>

        <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1 px-1.5 pt-2">
          {/* Explorer */}
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} isActive={isNavActive(item.href, pathname)} />
          ))}

          {/* Ask the Ledger — flagship Pro feature, top of section for prominence */}
          <div className="mt-2 border-t border-elevated pt-2">
            <NavLink item={askItem} isActive={isNavActive(askItem.href, pathname)} />
            <NavLink item={dashboardItem} isActive={isNavActive(dashboardItem.href, pathname)} />
            <NavLink item={smartMoneyItem} isActive={isNavActive(smartMoneyItem.href, pathname)} />
          </div>

          {/* Research — temporarily offline; nav link removed 2026-05-02 */}
        </nav>

        {/* Bottom nav — docs, about, etc. */}
        {/* Admin — treasury wallet only */}
        {isAdmin && (
          <div className="shrink-0 border-t border-elevated px-1.5 pt-2 pb-1">
            <NavLink item={adminItem} isActive={isNavActive(adminItem.href, pathname)} />
          </div>
        )}

        {/* Bottom nav — docs, pricing, about, etc. */}
        <div className="shrink-0 border-t border-elevated px-1.5 pt-2 pb-1">
          {bottomNavItems.map((item) => (
            <NavLink key={item.href} item={item} isActive={isNavActive(item.href, pathname)} />
          ))}
        </div>

        <div className="shrink-0 border-t border-elevated px-1.5 py-4">
          <div className="flex h-9 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            <span className="whitespace-nowrap font-display text-tag font-medium uppercase tracking-header text-success">
              Connected
            </span>
          </div>
          <SettingsPanel variant="sidebar" />
        </div>
      </aside>

      {/* Mobile Top Bar — logo + hamburger. Key resets open state on route change. */}
      <MobileHeader key={pathname} pathname={pathname} isAdmin={isAdmin} />
    </>
  );
}

/* ── Mobile header with hamburger drawer ── */

function MobileHeader({ pathname, isAdmin }: { pathname: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const drawerRef = useFocusTrap<HTMLElement>(open);

  // Close on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  return (
    <>
      <header className="fixed left-3 right-3 top-3 z-40 flex h-12 items-center justify-between rounded-2xl shadow-card bg-surface px-4 md:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          <SondeMark size={20} className="text-brand" />
          <SondeWordmark height={15} className="text-primary" />
        </Link>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            variant="ghost"
            size="md"
            iconOnly
            className="h-9 w-9"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </Button>
        </div>
      </header>

      {/* Drawer overlay — covers everything behind the panel. Adds
           `backdrop-blur-sm` + a subtle tint so the page softly
           recedes when the drawer is open; the drawer itself stays
           a solid surface on top. Fades in/out via AnimatePresence. */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Drawer panel — slides in from the right with `SPRING.layout`
           (matches the rest of the app's motion language). Always
           mounted so the focus-trap ref stays stable; `inert` +
           `aria-hidden` keep the closed drawer out of the screen-
           reader focus order and prevent keyboard tabbing into
           hidden nav links. */}
      <motion.nav
        ref={drawerRef}
        initial={false}
        animate={{ x: open ? "0%" : "100%" }}
        transition={SPRING.layout}
        className="fixed top-0 right-0 bottom-0 z-50 w-64 bg-surface shadow-lg md:hidden"
        role="dialog"
        aria-label="Navigation"
        aria-modal={open ? "true" : undefined}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="flex h-12 items-center justify-between px-4 mt-3">
          <span className="font-display text-ui font-semibold text-primary">Menu</span>
          <Button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            variant="ghost"
            size="md"
            iconOnly
            className="h-9 w-9"
          >
            <X size={20} />
          </Button>
        </div>

        <div className="flex flex-col gap-1 px-3 pt-2">
          {navItems.map((item) => {
            const active = isNavActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 font-body text-ui transition-colors",
                  active ? "bg-brand/10 text-brand" : "text-muted hover:text-primary hover:bg-elevated",
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}

          {/* Ask + Portfolio + Smart Money — Research temporarily offline (2026-05-02) */}
          <div className="mt-2 border-t border-elevated pt-2">
            {[askItem, dashboardItem, smartMoneyItem].map((item) => {
              const active = isNavActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 font-body text-ui transition-colors",
                    active ? "bg-brand/10 text-brand" : "text-muted hover:text-primary hover:bg-elevated",
                  )}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Admin — treasury wallet only */}
          {isAdmin && (
            <div className="mt-2 border-t border-elevated pt-2">
              <Link
                href={adminItem.href}
                aria-current={isNavActive(adminItem.href, pathname) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 font-body text-ui transition-colors",
                  isNavActive(adminItem.href, pathname) ? "bg-brand/10 text-brand" : "text-muted hover:text-primary hover:bg-elevated",
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">{adminItem.icon}</span>
                {adminItem.label}
              </Link>
            </div>
          )}

          {/* Bottom items */}
          <div className="mt-2 border-t border-elevated pt-2">
            {bottomNavItems.map((item) => {
              const active = isNavActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 font-body text-ui transition-colors",
                    active ? "bg-brand/10 text-brand" : "text-muted hover:text-primary hover:bg-elevated",
                  )}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
            <SettingsPanel variant="mobile" />
          </div>
        </div>
      </motion.nav>
    </>
  );
}
