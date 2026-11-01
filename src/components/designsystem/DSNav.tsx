import { useEffect, useState } from "react";
import { SondeMark } from "@/components/shared/SondeLogo";
import ThemeToggle from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";

const sections = [
  { id: "colors", label: "Colors" },
  { id: "typography", label: "Typography" },
  { id: "shadows", label: "Shadows" },
  { id: "components", label: "Components" },
];

export default function DSNav() {
  const [active, setActive] = useState("colors");

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter(Boolean) as HTMLElement[];

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px" }
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="fixed left-3 right-3 top-3 z-50 flex items-center justify-between rounded-2xl border border-line bg-surface px-5 py-2.5 shadow-card backdrop-blur-md" style={{ backgroundColor: "color-mix(in srgb, var(--color-surface) 90%, transparent)" }}>
      <div className="flex items-center gap-2.5">
        <SondeMark className="text-brand" />
        <span className="font-display text-caps text-primary">
          Design System
        </span>
      </div>

      <div className="flex items-center gap-1">
        <div className="hidden items-center gap-1 sm:flex">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" });
              }}
              className={cn(
                "px-3 py-1.5 font-display text-caps uppercase",
                active === s.id
                  ? "bg-accent text-on-accent"
                  : "text-muted hover:bg-primary hover:text-black"
              )}
            >
              {s.label}
            </a>
          ))}
        </div>
        <div className="ml-2 border-l border-line pl-2">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
