"use client";

import { useState } from "react";
import ToolsPanel from "@/components/portfolio/ToolsPanel";
import QueryPanel from "@/components/portfolio/QueryPanel";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "tools", label: "Tools" },
  { id: "query", label: "Query" },
];

/**
 * Side-panel that hosts the Tools + Query tabs. Used both as the desktop
 * sidebar in PortfolioDashboard and (via modal) as the contents of the
 * mobile "Tools" drawer.
 */
export default function SideToolsPanel() {
  const [active, setActive] = useState("tools");

  return (
    <div className="rounded-2xl border border-elevated bg-surface shadow-card overflow-hidden">
      <div className="border-b border-elevated px-4 pt-3">
        <div role="tablist" className="flex gap-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              id={`${tab.id}-side-tab`}
              role="tab"
              aria-selected={active === tab.id}
              aria-controls="portfolio-side-tabpanel"
              tabIndex={active === tab.id ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={cn(
                "whitespace-nowrap pb-3 font-display text-ui font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                active === tab.id
                  ? "border-b-2 border-brand text-primary"
                  : "text-muted hover:text-secondary",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div
        id="portfolio-side-tabpanel"
        role="tabpanel"
        aria-labelledby={`${active}-side-tab`}
        className="p-4"
      >
        {active === "tools" && <ToolsPanel />}
        {active === "query" && <QueryPanel />}
      </div>
    </div>
  );
}
