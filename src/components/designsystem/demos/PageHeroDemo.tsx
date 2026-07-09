"use client";

import { useState } from "react";
import DemoCard from "../shared/DemoCard";
import { TextControl } from "../shared/PropControl";

export default function PageHeroDemo() {
  const [title, setTitle] = useState("Tokens");
  const [accent, setAccent] = useState("Explorer");
  const [subtitle, setSubtitle] = useState("Browse and search all traded tokens on the XRPL.");

  return (
    <DemoCard
      name="PageHero"
      importPath="@/components/shared/PageHero"
      description="Page header with gradient background, grid overlay, title with optional accent span, and subtitle. Used on all explorer pages."
      preview={
        <div className="relative w-full overflow-hidden rounded-lg" style={{ minHeight: 140 }}>
          {/* HeroBackground replica (inline to avoid layout issues in contained preview) */}
          <div className="dashboard-gradient pointer-events-none absolute inset-0" />
          <div className="landing-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_30%,black_30%,transparent_100%)]" />

          <div className="relative px-6 pt-8 pb-6">
            <h1 className="font-display text-title font-bold leading-[1.1] tracking-[-0.5px] text-primary sm:text-display">
              {title}
              {accent && (
                <>
                  {" "}
                  <span className="text-brand">{accent}</span>
                </>
              )}
            </h1>
            <p className="mt-2 font-body text-lg text-secondary">{subtitle}</p>
          </div>
        </div>
      }
      controls={
        <>
          <TextControl label="title" value={title} onChange={setTitle} />
          <TextControl label="accent" value={accent} onChange={setAccent} />
          <TextControl label="subtitle" value={subtitle} onChange={setSubtitle} />
        </>
      }
      code={`<PageHero\n  title="${title}"\n  accent="${accent}"\n  subtitle="${subtitle}"\n/>`}
    />
  );
}
