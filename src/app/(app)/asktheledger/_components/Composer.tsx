"use client";

import { useEffect, useRef } from "react";
import { ArrowUp } from "lucide-react";
import Button from "@/components/shared/Button";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

const MAX_HEIGHT = 160;

export default function Composer({ value, onChange, onSubmit, loading }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the textarea up to MAX_HEIGHT, then scroll inside.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !loading;

  return (
    <div className="sticky bottom-0 z-10 mt-4">
      {/* Soft fade so messages don't hard-cut into the composer's bg */}
      <div
        aria-hidden="true"
        className="pointer-events-none -mt-6 h-6 bg-gradient-to-t from-black to-transparent"
      />
      <div className="bg-black pb-4 pt-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) onSubmit();
          }}
          className="flex items-center gap-2 rounded-2xl border border-elevated bg-surface p-2 shadow-card focus-within:border-brand/40 transition-colors"
        >
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSubmit();
              }
            }}
            placeholder="Ask a question about the XRPL…"
            disabled={loading}
            rows={1}
            className="flex-1 resize-none bg-transparent px-3 py-2 font-body text-ui text-primary placeholder:text-muted/60 focus-visible:outline-none disabled:opacity-50"
            aria-label="Question input"
          />
          <Button
            type="submit"
            disabled={!canSend}
            loading={loading}
            variant="primary"
            size="md"
            iconOnly
            className="shrink-0"
            aria-label={loading ? "Sending…" : "Send question"}
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </Button>
        </form>
        {/* Keyboard hint is desktop-only — mobile users have no
            Shift modifier and the virtual keyboard's return key
            already submits via the Enter handler above. */}
        <p className="mt-1.5 hidden px-1 font-mono text-label text-muted sm:block">
          <kbd className="font-mono">Enter</kbd> to send,{" "}
          <kbd className="font-mono">Shift + Enter</kbd> for newline
        </p>
      </div>
    </div>
  );
}
