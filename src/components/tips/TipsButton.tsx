"use client";

import { HelpCircle } from "lucide-react";
import { motion } from "motion/react";
import { dispatchRestartTips } from "@/lib/tips-state";
import {
  HOVER_SCALE,
  ICON_HOVER_SCALE,
  ICON_TAP_SCALE,
  SPRING,
  TAP_SCALE,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

interface TipsButtonProps {
  /** Must match the `pageId` of the `<TipTour>` to be triggered. */
  pageId: string;
  /**
   * `text` (default) renders a labelled pill suitable for a page
   * header. `icon` renders a compact icon-only button — use it when
   * space is tight (e.g. inside a dense toolbar).
   */
  variant?: "text" | "icon";
  className?: string;
}

/**
 * "Show tips" trigger — restarts a page's tutorial tour via the
 * shared restart bus in `lib/tips-state`. The sibling `<TipTour
 * pageId={...}/>` listens on the same channel and resets its step
 * state when this button is clicked.
 *
 * No props for "is the tour active" or "has it been completed" — that
 * lives inside TipTour and isn't relevant for this trigger. Clicking
 * always (re-)starts from step 0.
 */
export default function TipsButton({
  pageId,
  variant = "text",
  className,
}: TipsButtonProps) {
  if (variant === "icon") {
    return (
      <motion.button
        type="button"
        onClick={() => dispatchRestartTips(pageId)}
        aria-label="Show page tips"
        whileHover={{ scale: ICON_HOVER_SCALE, transition: SPRING.smooth }}
        whileTap={{ scale: ICON_TAP_SCALE, transition: SPRING.pop }}
        style={{ willChange: "transform" }}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted",
          "transition-colors hover:bg-elevated hover:text-brand",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
          className,
        )}
      >
        <HelpCircle size={16} aria-hidden="true" />
      </motion.button>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={() => dispatchRestartTips(pageId)}
      whileHover={{ scale: HOVER_SCALE, transition: SPRING.smooth }}
      whileTap={{ scale: TAP_SCALE, transition: SPRING.pop }}
      style={{ willChange: "transform" }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-elevated bg-elevated/60 px-3 py-1.5",
        "font-mono text-label font-medium uppercase tracking-pill text-muted",
        "transition-colors hover:border-brand/30 hover:text-brand",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        className,
      )}
    >
      <HelpCircle size={12} aria-hidden="true" />
      <span>Show tips</span>
    </motion.button>
  );
}
