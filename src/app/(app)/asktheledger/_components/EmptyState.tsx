"use client";

import { Sparkles } from "lucide-react";
import { EXAMPLE_QUESTIONS } from "@/lib/intel-schemas";

interface Props {
  onPick: (q: string) => void;
  loading: boolean;
}

export default function EmptyState({ onPick, loading }: Props) {
  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2 px-1 font-display text-tag uppercase tracking-header text-muted">
        <Sparkles size={12} className="text-brand" aria-hidden="true" />
        <span>Try one of these</span>
      </div>

      {/* Mobile: single-row horizontal scroller. The right-edge fade
          plus the half-clipped trailing pill telegraph that more exist.
          Desktop (sm+): wrapping flex so pills pack densely without
          eating vertical space. Same pill primitive both ways. */}
      <div className="relative -mx-3 sm:mx-0">
        <div
          className="flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:px-0"
        >
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => onPick(q)}
              disabled={loading}
              className="shrink-0 whitespace-nowrap rounded-full border border-elevated bg-elevated/30 px-3 py-1.5 font-body text-cell text-secondary transition-colors hover:border-brand/30 hover:bg-brand/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-50 sm:shrink"
            >
              {q}
            </button>
          ))}
        </div>
        {/* Right-edge scroll-affordance fade — mobile only */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-black to-transparent sm:hidden"
        />
      </div>
    </div>
  );
}
