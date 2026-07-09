"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CurrentPortfolio {
  totalValueUsd: number;
}

const STORAGE_KEY = "sonde-portfolio-goal";

export default function GoalTracker() {
  const { data } = useSWR<CurrentPortfolio>(
    CACHE_KEYS.portfolioCurrent(),
    fetcher,
  );

  const [goal, setGoal] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      return stored ? Number(stored) : null;
    } catch {
      return null;
    }
  });
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");

  if (!data) return null;

  const current = data.totalValueUsd;
  const progress = goal && goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
  const remaining = goal ? Math.max(goal - current, 0) : 0;
  const reached = goal ? current >= goal : false;

  function saveGoal() {
    const val = parseFloat(input.replace(/[,$]/g, ""));
    if (!isNaN(val) && val > 0) {
      setGoal(val);
      try {
        sessionStorage.setItem(STORAGE_KEY, val.toString());
      } catch {
        /* unavailable */
      }
    }
    setEditing(false);
    setInput("");
  }

  function clearGoal() {
    setGoal(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* unavailable */
    }
  }

  if (!goal && !editing) {
    return (
      <div className="flex items-center justify-between rounded-xl bg-elevated px-4 py-3">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Portfolio Goal
        </span>
        <button
          onClick={() => setEditing(true)}
          className="font-mono text-tag font-medium text-brand hover:text-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          Set Goal
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-elevated px-4 py-3">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Target
        </span>
        <div className="flex flex-1 items-center gap-2">
          <span className="font-mono text-cell text-muted">$</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveGoal()}
            placeholder="100,000"
            autoFocus
            aria-label="Target goal amount"
            className="w-full bg-transparent font-mono text-cell tabular-nums text-primary outline-none placeholder:text-muted"
          />
        </div>
        <button
          onClick={saveGoal}
          className="font-mono text-tag font-medium text-brand hover:text-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          Save
        </button>
        <button
          onClick={() => setEditing(false)}
          className="font-mono text-tag font-medium text-muted hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-elevated px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Goal: {formatVolume(goal!)}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setInput(goal!.toString());
              setEditing(true);
            }}
            className="font-mono text-tag font-medium text-muted hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            Edit
          </button>
          <button
            onClick={clearGoal}
            className="font-mono text-tag font-medium text-muted hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 overflow-hidden rounded-full bg-surface">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            reached ? "bg-success" : "bg-brand",
          )}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span
          className={cn(
            "font-mono text-tag font-semibold tabular-nums",
            reached ? "text-success" : "text-primary",
          )}
        >
          {progress.toFixed(1)}%
        </span>
        {!reached && (
          <span className="font-mono text-tag tabular-nums text-muted">
            {formatVolume(remaining)} to go
          </span>
        )}
        {reached && (
          <span className="font-mono text-tag font-semibold text-success">
            Goal reached!
          </span>
        )}
      </div>
    </div>
  );
}
