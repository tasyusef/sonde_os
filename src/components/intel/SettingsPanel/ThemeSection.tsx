"use client";

import { useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeSection() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("sonde-theme") !== "light";
  });

  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("sonde-theme", next ? "dark" : "light");
    if (next) document.documentElement.classList.remove("light");
    else document.documentElement.classList.add("light");
  };

  return (
    <div>
      <span className="font-display text-label font-semibold uppercase tracking-header text-muted">Theme</span>
      <button
        onClick={toggle}
        aria-pressed={dark}
        className="mt-1.5 flex w-full items-center gap-2.5 rounded-lg border border-elevated bg-surface px-3 py-2 font-mono text-cell text-primary hover:bg-elevated hover:border-brand/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        {dark ? <Sun size={14} /> : <Moon size={14} />}
        {dark ? "Switch to light" : "Switch to dark"}
      </button>
    </div>
  );
}
