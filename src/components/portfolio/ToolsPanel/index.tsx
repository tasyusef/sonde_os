"use client";

import WatchlistTab from "@/components/intel/IntelligenceDashboard/WatchlistTab";
import AlertsPanel from "@/components/intel/AlertsPanel";
import WhatIfSimulator from "@/components/portfolio/WhatIfSimulator";
import GoalTracker from "@/components/portfolio/GoalTracker";
import SideCard from "./SideCard";

export default function ToolsPanel() {
  return (
    <div className="flex flex-col gap-4">
      <SideCard title="Watchlist">
        <WatchlistTab />
      </SideCard>
      <SideCard title="Alerts">
        <AlertsPanel />
      </SideCard>
      <WhatIfSimulator expanded />
      <SideCard title="Portfolio Goal" defaultExpanded={false}>
        <GoalTracker />
      </SideCard>
    </div>
  );
}
