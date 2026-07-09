import type { ReactNode } from "react";

/**
 * One step in a page's tutorial tour.
 *
 * `target` is a CSS selector — usually a `data-tip="..."` attribute
 * placed on the element to highlight. Selector keeps step definitions
 * decoupled from React refs and lets a page declare its tour as a
 * plain array next to the page itself.
 */
export interface TipStep {
  /** Stable id for debugging / analytics. */
  id: string;
  /** Headline of the tooltip — short, sentence case. */
  title: string;
  /** Supporting body content. Plain string or a React node. */
  body: ReactNode;
  /** CSS selector for the element the tooltip points at. Must resolve
   *  to exactly one element when the step is active. */
  target: string;
  /** Preferred side to anchor the tooltip on. Auto-flips if the
   *  preferred side would push the tooltip off-screen. Default `bottom`. */
  placement?: "top" | "bottom" | "left" | "right";
}
