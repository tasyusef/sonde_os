import { useSyncExternalStore } from "react";

/**
 * Site theme store. The source of truth is the `light` class on <html>:
 * the inline script in the root layout sets it before first paint (from
 * localStorage), and `setTheme()` updates it. Every theme-aware component
 * reads from here, so toggles anywhere stay in sync — including routes that
 * force a theme by touching the class directly.
 */

export type Theme = "dark" | "light";

const STORAGE_KEY = "sonde-theme";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** Current theme straight from the DOM (client only). */
export function getTheme(): Theme {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

const getServerSnapshot = (): Theme => "dark";

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("light", theme === "light");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage blocked — the class change still applies */
  }
}

export function useTheme(): { theme: Theme; isDark: boolean; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerSnapshot);
  return {
    theme,
    isDark: theme === "dark",
    toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
  };
}
