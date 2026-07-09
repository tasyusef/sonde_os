"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Button from "@/components/shared/Button";

const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function ThemeIcon({ dark }: { dark: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {dark ? (
        <motion.svg
          key="sun"
          initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          {...iconProps}
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </motion.svg>
      ) : (
        <motion.svg
          key="moon"
          initial={{ opacity: 0, rotate: 90, scale: 0.8 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: -90, scale: 0.8 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          {...iconProps}
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </motion.svg>
      )}
    </AnimatePresence>
  );
}

export default function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "nav" }) {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("sonde-theme") !== "light";
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.add("light");
    }
  }, [dark]);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("sonde-theme", next ? "dark" : "light");
  };

  if (variant === "nav") {
    return (
      <button
        onClick={toggle}
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        className="flex h-9 w-full items-center gap-3 rounded-xl transition-colors text-muted hover:bg-row-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center text-muted">
          <ThemeIcon dark={dark} />
        </span>
        <span className="whitespace-nowrap font-mono text-tag">
          Theme
        </span>
      </button>
    );
  }

  return (
    <Button
      onClick={toggle}
      variant="ghost"
      size="sm"
      iconOnly
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="hover:bg-row-hover active:scale-90"
    >
      <ThemeIcon dark={dark} />
    </Button>
  );
}
