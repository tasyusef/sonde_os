"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import Button from "@/components/shared/Button";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import ThemeSection from "./ThemeSection";
import WalletSection from "./WalletSection";
import AiSection from "./AiSection";

interface SettingsPanelProps {
  variant?: "sidebar" | "mobile";
}

export default function SettingsPanel({ variant = "sidebar" }: SettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);

  const close = useCallback(() => { setOpen(false); triggerRef.current?.focus(); }, []);

  // Trigger — matches NavLink styles exactly
  const trigger = variant === "sidebar" ? (
    <button
      ref={triggerRef}
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      className="flex h-9 w-full items-center gap-3 rounded-xl pr-3 font-display text-ui font-medium tracking-nav transition-all duration-200 hover:scale-[1.04] active:scale-[0.97] text-muted hover:bg-row-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center text-muted">
        <Settings size={20} />
      </span>
      <span className="whitespace-nowrap">Settings</span>
    </button>
  ) : (
    <button
      ref={triggerRef}
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 font-body text-ui text-muted hover:text-primary hover:bg-elevated transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center"><Settings size={20} /></span>
      Settings
    </button>
  );

  // Close on Escape, restore focus to trigger
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  return (
    <>
      {trigger}

      {open && (
        <div className="fixed inset-0 z-[59]" onClick={close} aria-hidden="true" />
      )}

      {open && (
        <div
          ref={dialogRef}
          className={cn(
            "fixed z-[60] w-72 rounded-2xl border border-elevated bg-surface shadow-card",
            // Mobile placement uses the `--floating-bottom-mobile` token
            // (5rem + safe-area-inset-bottom) so the dialog clears iOS
            // Safari's bottom chrome and any FAB anchored above it.
            variant === "sidebar"
              ? "bottom-4 left-16"
              : "bottom-[var(--floating-bottom-mobile)] right-4",
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-elevated">
            <span className="font-display text-ui font-semibold text-primary">Settings</span>
            <Button onClick={close} variant="ghost" size="sm" iconOnly aria-label="Close" className="h-7 w-7">
              <X size={14} />
            </Button>
          </div>

          <div className="p-4 space-y-4">
            <ThemeSection />
            <WalletSection onDone={close} />
            <AiSection />
          </div>
        </div>
      )}
    </>
  );
}
