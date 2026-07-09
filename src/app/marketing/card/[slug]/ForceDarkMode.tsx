"use client";

import { useEffect } from "react";

/**
 * Marketing card screenshots must always render in dark mode regardless
 * of the user's saved theme preference. The root layout's inline script
 * reads `localStorage['sonde-theme']` and adds `.light` to the html element
 * if set — this component strips it on mount so screenshots stay consistent.
 *
 * The brief flash on first paint is irrelevant since this route is only
 * used as a screenshot target — the capture happens after the page settles.
 */
export default function ForceDarkMode() {
  useEffect(() => {
    document.documentElement.classList.remove("light");
  }, []);
  return null;
}
