import { type ReactNode } from "react";
import { SidebarLogo } from "@/components/layout/Sidebar/SidebarLogo";
import { LedgerReadout } from "@/components/layout/StatusStrip/LedgerReadout";

/** The mobile header's row, on the page ground: the logo as the
 *  sidebar sets it, the latest ledger, then `children` (the menu or a
 *  close button). The header and the sheets draw the same row, so a
 *  sheet opens under a bar that doesn't move. */
export default function MobileBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[var(--topbar-h-mobile)] shrink-0 items-center gap-4 bg-black px-2.5">
      <SidebarLogo />
      <div className="ml-auto min-w-0 font-mono text-micro">
        <LedgerReadout compact />
      </div>
      {children}
    </div>
  );
}
