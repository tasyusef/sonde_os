import { useState } from "react";
import { Reveal } from "@/components/shared/Reveal";
import DemoCard from "../shared/DemoCard";
import { NumberControl } from "../shared/PropControl";

const cards = ["Alpha", "Beta", "Gamma", "Delta"];

export default function RevealDemo() {
  const [delay, setDelay] = useState(100);
  const [key, setKey] = useState(0);

  return (
    <DemoCard
      name="Reveal"
      importPath="@/components/shared/Reveal"
      description="Scroll-triggered entrance animation. Elements above the fold stay visible; below-fold elements fade in on scroll. Uses IntersectionObserver + Framer Motion."
      preview={
        <div className="w-full space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setKey((k) => k + 1)}
              className="rounded-lg bg-elevated px-3 py-1.5 font-mono text-label font-medium text-primary"
            >
              Reset Animation
            </button>
          </div>
          <div key={key} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cards.map((label, i) => (
              <Reveal key={label} delay={i * delay}>
                <div className="flex h-20 items-center justify-center rounded-lg border border-line bg-elevated font-mono text-cell font-medium text-primary">
                  {label}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      }
      controls={
        <NumberControl
          label="delay (ms)"
          value={delay}
          onChange={setDelay}
          min={0}
          max={500}
          step={50}
        />
      }
      code={`<Reveal delay={${delay}}>\n  <Card />\n</Reveal>`}
    />
  );
}
