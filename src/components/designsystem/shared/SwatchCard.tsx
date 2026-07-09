"use client";

import { useEffect, useState } from "react";

function readHex(variable: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || "—";
}

export default function SwatchCard({
  name,
  variable,
}: {
  name: string;
  variable: string;
}) {
  const [hex, setHex] = useState(() => readHex(variable));

  // Re-read on theme change (listen for class changes on <html>)
  // The callback also runs on mount via requestAnimationFrame to pick up
  // the correct computed style after hydration.
  useEffect(() => {
    const update = () => setHex(readHex(variable));
    const rafId = requestAnimationFrame(update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [variable]);

  return (
    <div className="space-y-2">
      <div
        className="h-16 w-full rounded-lg border border-elevated"
        style={{ backgroundColor: `var(${variable})` }}
      />
      <div>
        <p className="font-mono text-cell font-medium text-primary">{name}</p>
        <p className="font-mono text-label text-muted">{variable}</p>
        <p className="font-mono text-label text-muted">{hex}</p>
      </div>
    </div>
  );
}
