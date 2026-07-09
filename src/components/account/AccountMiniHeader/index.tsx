"use client";

import WatchButton from "@/components/account/WatchButton";
import { truncate } from "@/lib/xrpl-helpers";

/**
 * Mobile-only compact header for the account page. Replaces the heavy
 * hero section on small viewports — just the known wallet name (or
 * truncated address as fallback) and the watch button, rendered as a
 * floating pill below the top nav.
 *
 * Desktop users see the full hero section instead; this component is
 * rendered with `lg:hidden`.
 */
export default function AccountMiniHeader({
  address,
  knownName,
}: {
  address: string;
  knownName?: string | null;
}) {
  const label = knownName ?? truncate(address, 5);

  return (
    <div className="sticky top-[var(--topbar-h-mobile)] z-30 -mt-3 px-4 pt-2 lg:mt-0 lg:hidden">
      <div className="flex items-center justify-between gap-3 rounded-full border border-elevated bg-surface px-4 py-1.5 shadow-card">
        <span className="truncate font-mono text-cell font-semibold text-primary">
          {label}
        </span>
        <WatchButton address={address} />
      </div>
    </div>
  );
}
