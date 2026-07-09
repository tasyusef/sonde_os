"use client";

import { useState } from "react";
import { ChevronDown, History, Plus } from "lucide-react";
import type { HistoryEntry } from "@/lib/asktheledger-history";
import { cn } from "@/lib/utils";
import HistoryItem from "./HistoryItem";
import { groupHistoryByDate } from "./utils";

interface Props {
  history: HistoryEntry[];
  activeId: number | null;
  deletingIds: Set<number>;
  onSelect: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
  onNewChat: () => void;
  hasActiveChat: boolean;
}

/** Collapsible history panel for mobile. Shown above the chat column,
 *  hidden on lg+ (where the rail handles it). */
export default function MobileHistory({
  history,
  activeId,
  deletingIds,
  onSelect,
  onDelete,
  onNewChat,
  hasActiveChat,
}: Props) {
  const [open, setOpen] = useState(false);
  const groups = groupHistoryByDate(history);
  const count = history.length;

  return (
    <div className="mb-3 lg:hidden">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="mobile-history-panel"
          className="flex flex-1 items-center justify-between gap-2 rounded-xl border border-elevated bg-surface px-3 py-2 font-mono text-cell text-secondary transition-colors hover:border-brand/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <span className="inline-flex items-center gap-2">
            <History size={14} aria-hidden="true" />
            <span className="uppercase tracking-header text-tag text-muted">
              History
            </span>
            {count > 0 && (
              <span className="rounded-tag bg-elevated px-1.5 font-mono text-label text-muted">
                {count}
              </span>
            )}
          </span>
          <ChevronDown
            size={14}
            className={cn("transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {hasActiveChat && (
          <button
            onClick={onNewChat}
            aria-label="Start a new chat"
            className="inline-flex items-center gap-1 rounded-xl border border-elevated bg-surface px-3 py-2 font-display text-tag uppercase tracking-header text-muted transition-colors hover:border-brand/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <Plus size={12} strokeWidth={2.5} aria-hidden="true" />
            <span>New</span>
          </button>
        )}
      </div>

      {open && (
        <div
          id="mobile-history-panel"
          className="mt-2 max-h-[60vh] overflow-y-auto rounded-xl border border-elevated bg-surface px-2 py-2 shadow-card"
        >
          {history.length === 0 ? (
            <p className="px-2 py-3 font-body text-cell text-muted">
              Your past conversations will appear here.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-3 last:mb-0">
                <p className="px-2 pb-1 pt-2 font-display text-label uppercase tracking-header text-muted/70">
                  {group.label}
                </p>
                <div className="flex flex-col gap-0.5">
                  {group.entries.map((entry) => (
                    <HistoryItem
                      key={entry.id}
                      entry={entry}
                      active={activeId === entry.id}
                      deleting={deletingIds.has(entry.id)}
                      onClick={() => {
                        onSelect(entry);
                        setOpen(false);
                      }}
                      onDelete={() => onDelete(entry)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
