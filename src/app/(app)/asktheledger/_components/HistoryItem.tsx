"use client";

import { BarChart3, Hash, Table2, AlignLeft, Trash2 } from "lucide-react";
import type { HistoryEntry } from "@/lib/asktheledger-history";
import { cn } from "@/lib/utils";
import { formatRelative, resultKind, type ResultKind } from "./utils";

const KIND_META: Record<
  ResultKind,
  { label: string; Icon: typeof BarChart3 }
> = {
  chart: { label: "Chart", Icon: BarChart3 },
  stat: { label: "Stat", Icon: Hash },
  table: { label: "Table", Icon: Table2 },
  text: { label: "Answer", Icon: AlignLeft },
};

interface Props {
  entry: HistoryEntry;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  /** Whether a delete is currently in-flight for this entry. */
  deleting?: boolean;
}

/** A single entry row used by both the desktop rail and the mobile panel.
 *  Renders as a row with the main click target + an inline delete button.
 *  Uses div + role="button" on the wrapper instead of nesting <button>s. */
export default function HistoryItem({
  entry,
  active,
  onClick,
  onDelete,
  deleting,
}: Props) {
  const kind = resultKind(entry);
  const { Icon, label } = KIND_META[kind];

  return (
    <div
      className={cn(
        "group relative flex items-stretch gap-1 rounded-lg border transition-colors",
        active
          ? "border-brand/40 bg-brand/10"
          : "border-transparent hover:border-elevated hover:bg-elevated/40",
        deleting && "opacity-50 pointer-events-none",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className="flex flex-1 flex-col gap-1 rounded-l-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <span
          className={cn(
            "line-clamp-2 font-body text-cell leading-snug",
            active ? "text-primary" : "text-secondary group-hover:text-primary",
          )}
        >
          {entry.question}
        </span>
        <span className="flex items-center justify-between font-mono text-label text-muted">
          <span className="inline-flex items-center gap-1">
            <Icon size={11} aria-hidden="true" />
            <span>{label}</span>
          </span>
          <time dateTime={entry.createdAt}>{formatRelative(entry.createdAt)}</time>
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete: ${entry.question}`}
        className="flex shrink-0 items-center justify-center rounded-r-lg px-2 text-muted opacity-60 transition-all hover:text-error focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 lg:opacity-0 lg:group-hover:opacity-100"
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
