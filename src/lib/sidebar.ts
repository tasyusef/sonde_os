/**
 * The desktop sidebar's collapsed state. The source of truth is the
 * `sidebar-rail` class on <html>: the root's prefs script sets it from
 * localStorage before first paint, and CSS (the `rail:` variant) draws
 * everything that changes, so no component renders from it.
 */
const STORAGE_KEY = "sonde-sidebar";

export function toggleSidebar() {
  const rail = document.documentElement.classList.toggle("sidebar-rail");
  try {
    if (rail) localStorage.setItem(STORAGE_KEY, "rail");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked — the class change still applies */
  }
}
