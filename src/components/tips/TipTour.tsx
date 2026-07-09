"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import {
  setTipsCompleted,
  subscribeRestartTips,
  useTipsCompleted,
} from "@/lib/tips-state";
import Tip from "./Tip";
import type { TipStep } from "./types";

interface TipTourProps {
  /**
   * Stable identifier for this page's tour. Used as the localStorage
   * key for the completed/dismissed flag and as the channel name on
   * the restart bus (so a `<TipsButton>` on the same page can
   * re-trigger this tour without lifting state).
   */
  pageId: string;
  steps: TipStep[];
  /**
   * Auto-start the tour on first visit if the user hasn't already
   * completed or dismissed it. Default true. Set to false when you
   * want the page to start "quiet" and only show the tour on explicit
   * `<TipsButton>` click.
   */
  autoStart?: boolean;
}

/**
 * Per-user manual override of the auto-show baseline. While `kind`
 * is `"auto"`, the rendered step index is derived purely from the
 * persisted "completed" flag (via `useTipsCompleted`). After any
 * Next/Back/Skip/Done/Restart click, we flip to `"manual"` and the
 * stored `index` drives the render. Keeping the derived-state
 * baseline separate from the override lets the auto-show check
 * stay synchronous (via `useSyncExternalStore` inside
 * `useTipsCompleted`) — no setState-in-effect to flip from `null`
 * → `0` on mount.
 */
type Override =
  | { kind: "auto" }
  | { kind: "manual"; index: number | null };

/**
 * Sequential tutorial-tooltip tour for a page. Renders one `<Tip>` at
 * a time, points it at the current step's target element, and exposes
 * Next/Back/Skip controls. State persists per pageId in localStorage;
 * once completed or dismissed, the tour won't auto-start again. A
 * sibling `<TipsButton pageId={...}/>` anywhere on the page can
 * re-trigger it via the restart bus.
 *
 * Place this near the bottom of the page render — the portal in
 * `<Tip>` mounts to `document.body` regardless, but keeping the
 * declaration adjacent to the page's other content makes it easier
 * to find when editing the step list.
 */
export default function TipTour({ pageId, steps, autoStart = true }: TipTourProps) {
  const alreadyCompleted = useTipsCompleted(pageId);
  const shouldAutoShow =
    autoStart && !alreadyCompleted && steps.length > 0;

  const [override, setOverride] = useState<Override>({ kind: "auto" });

  // The active step index — derived. While in "auto" mode, the
  // baseline auto-show flag picks between step 0 (first visit) and
  // null (already dismissed). Any user interaction promotes to
  // "manual" and the stored index takes over.
  const activeIndex: number | null =
    override.kind === "manual"
      ? override.index
      : shouldAutoShow
        ? 0
        : null;

  const close = useCallback(
    (markCompleted: boolean) => {
      setOverride({ kind: "manual", index: null });
      if (markCompleted) setTipsCompleted(pageId, true);
    },
    [pageId],
  );

  /**
   * Walk in `direction` (+1 forward, -1 back) from `from` (inclusive)
   * to find the next step whose target selector resolves in the DOM.
   * Lets the tour gracefully skip a step that's only valid for a
   * particular page state (e.g. the analytics-filter step is only
   * useful when the Analytics tab is active). Returns null when no
   * valid step is found before the array end.
   */
  const findValidStep = useCallback(
    (from: number, direction: 1 | -1): number | null => {
      let i = from;
      while (i >= 0 && i < steps.length) {
        if (document.querySelector(steps[i].target)) return i;
        i += direction;
      }
      return null;
    },
    [steps],
  );

  const next = useCallback(() => {
    const current = activeIndex ?? 0;
    const found = findValidStep(current + 1, 1);
    if (found == null) {
      close(true);
    } else {
      setOverride({ kind: "manual", index: found });
    }
  }, [activeIndex, findValidStep, close]);

  const prev = useCallback(() => {
    const current = activeIndex ?? 0;
    const found = findValidStep(current - 1, -1);
    setOverride({ kind: "manual", index: found ?? 0 });
  }, [activeIndex, findValidStep]);

  const skip = useCallback(() => close(true), [close]);

  // Restart bus — TipsButton dispatches; jump back to the first
  // step whose target is currently in the DOM (so if the user's
  // page state hides a step's anchor, we don't restart into an
  // invisible tip).
  useEffect(() => {
    return subscribeRestartTips(pageId, () => {
      const found = findValidStep(0, 1);
      if (found != null) {
        setOverride({ kind: "manual", index: found });
      }
    });
  }, [pageId, findValidStep]);

  // Escape to skip while the tour is open.
  useEffect(() => {
    if (activeIndex == null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeIndex, skip]);

  const activeStep =
    activeIndex == null ? null : (steps[activeIndex] ?? null);

  return (
    // mode="wait" so an outgoing Tip finishes its exit animation BEFORE
    // the next Tip mounts. Default "sync" left both Tips in the DOM
    // simultaneously during step transitions, and a tap during that
    // ~300ms overlap could land on the wrong one (or the wrong onClick
    // handler) and silently no-op — same class of bug as the Skip-
    // doesn't-dismiss-the-tour report on mobile.
    <AnimatePresence mode="wait">
      {activeStep && activeIndex != null && (
        <Tip
          key={activeStep.id}
          step={activeStep}
          currentIndex={activeIndex}
          total={steps.length}
          onPrev={activeIndex > 0 ? prev : undefined}
          onNext={next}
          onSkip={skip}
        />
      )}
    </AnimatePresence>
  );
}
