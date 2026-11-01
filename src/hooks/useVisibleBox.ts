import { useSyncExternalStore } from "react";

/**
 * The part of the screen you can see (the visual viewport), for a sheet
 * with a field at its bottom. A phone's keyboard covers `position:
 * fixed` without shrinking the layout viewport, so the sheet pins
 * itself to this box instead and stays above the keyboard.
 */
export interface VisibleBox {
  top: number;
  height: number;
  /** An on-screen keyboard covers the rest. */
  keyboard: boolean;
}

/** A keyboard takes far more than a browser's collapsing toolbars do. */
const KEYBOARD_MIN = 150;

/** The box for these measurements, or `prev` itself when nothing
 *  changed, so `useSyncExternalStore` sees a stable snapshot. */
export function nextBox(
  prev: VisibleBox | null,
  vv: { offsetTop: number; height: number },
  layoutHeight: number,
): VisibleBox {
  const keyboard = layoutHeight - vv.height > KEYBOARD_MIN;
  if (prev && prev.top === vv.offsetTop && prev.height === vv.height && prev.keyboard === keyboard) {
    return prev;
  }
  return { top: vv.offsetTop, height: vv.height, keyboard };
}

let box: VisibleBox | null = null;

function read(): VisibleBox | null {
  const vv = window.visualViewport;
  if (!vv) return null;
  box = nextBox(box, vv, document.documentElement.clientHeight);
  return box;
}

function subscribe(onChange: () => void) {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", onChange);
  vv?.addEventListener("scroll", onChange);
  return () => {
    vv?.removeEventListener("resize", onChange);
    vv?.removeEventListener("scroll", onChange);
  };
}

const none = () => null;
const ignore = () => () => {};

/** The visible box while `enabled`; `null` otherwise, on the server
 *  and without the API (then the sheet keeps to `inset-0`). */
export function useVisibleBox(enabled: boolean): VisibleBox | null {
  return useSyncExternalStore(enabled ? subscribe : ignore, enabled ? read : none, none);
}
