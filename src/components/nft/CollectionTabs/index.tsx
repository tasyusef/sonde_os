"use client";

import type { ReactNode } from "react";
import Tabs from "@/components/shared/Tabs";
import { useTabSlug } from "@/hooks/useTabSlug";

const TAB_DEFS = [
  { id: "items", label: "Items" },
  { id: "trades", label: "Trades" },
  { id: "mints", label: "Mints" },
  { id: "listings", label: "Listings" },
  { id: "burns", label: "Burns" },
] as const;

type TabId = (typeof TAB_DEFS)[number]["id"];

/**
 * Tabs orchestrator for the collection detail page's left column.
 *
 * Each tab's content is pre-rendered server-side and handed in as a
 * slot prop (items / trades / mints / listings / burns). The active
 * tab is persisted in the URL via `useTabSlug("items", "tab")`, so
 * `?tab=trades` deep-links to the trades tab. The non-active panels
 * are still in the DOM (hidden via `display: none`) so switching
 * tabs is instant — server-rendered content doesn't re-fetch on
 * click.
 *
 * Default tab is `items` (the main view someone landing on the
 * collection page wants to see).
 */
export default function CollectionTabs({
  items,
  trades,
  mints,
  listings,
  burns,
}: {
  items: ReactNode;
  trades: ReactNode;
  mints: ReactNode;
  listings: ReactNode;
  burns: ReactNode;
}) {
  const [activeTab, setActiveTab] = useTabSlug<TabId>("items", "tab");

  const panels: Record<TabId, ReactNode> = {
    items,
    trades,
    mints,
    listings,
    burns,
  };

  return (
    <div>
      <Tabs
        tabs={TAB_DEFS as unknown as { id: string; label: string }[]}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
        panelId="collection-tabpanel"
      />
      <div
        id="collection-tabpanel"
        role="tabpanel"
        aria-labelledby={`${activeTab}-tab`}
        className="pt-6"
      >
        {/* Render all panels but hide the inactive ones via CSS.
            Keeps the server-rendered content in the DOM so tab
            switches are instant — no re-fetch, no skeleton flash. */}
        {(Object.keys(panels) as TabId[]).map((id) => (
          <div key={id} hidden={id !== activeTab}>
            {panels[id]}
          </div>
        ))}
      </div>
    </div>
  );
}
