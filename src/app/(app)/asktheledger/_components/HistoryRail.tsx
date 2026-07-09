"use client";

import { Plus } from "lucide-react";
import type { HistoryEntry } from "@/lib/asktheledger-history";
import Button from "@/components/shared/Button";
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

export default function HistoryRail({
  history,
  activeId,
  deletingIds,
  onSelect,
  onDelete,
  onNewChat,
  hasActiveChat,
}: Props) {
  const groups = groupHistoryByDate(history);

  return (
    <aside className="hidden lg:block" aria-label="Conversation history">
      <div className="sticky top-3 flex h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-elevated px-4 py-3">
          <h2 className="font-display text-tag uppercase tracking-header text-muted">
            History
          </h2>
          <Button
            onClick={onNewChat}
            disabled={!hasActiveChat}
            variant="ghost"
            size="sm"
            leftIcon={<Plus size={12} strokeWidth={2.5} />}
            className="font-display text-label uppercase tracking-header"
          >
            New chat
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {history.length === 0 ? (
            <p className="px-2 pt-4 font-body text-cell text-muted">
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
                      onClick={() => onSelect(entry)}
                      onDelete={() => onDelete(entry)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
