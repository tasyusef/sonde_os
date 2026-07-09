"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SideCard({
  title,
  children,
  defaultExpanded = true,
  headerRight,
}: {
  title: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  headerRight?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="flex flex-col rounded-2xl shadow-card bg-surface">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between border-b border-elevated px-4 py-card-header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-t-2xl"
      >
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          {title}
        </span>
        <div className="flex items-center gap-2">
          {headerRight}
          <ChevronDown
            size={14}
            className={cn(
              "text-muted transition-transform duration-200",
              !expanded && "-rotate-90",
            )}
          />
        </div>
      </button>
      {expanded && <div className="px-4 py-4">{children}</div>}
    </div>
  );
}
