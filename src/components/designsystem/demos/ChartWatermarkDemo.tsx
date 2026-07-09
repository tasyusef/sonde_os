"use client";

import { useState } from "react";
import { SondeMark, SondeWordmark } from "@/components/shared/SondeLogo";
import DemoCard from "../shared/DemoCard";
import { NumberControl } from "../shared/PropControl";

export default function ChartWatermarkDemo() {
  const [opacity, setOpacity] = useState(3);

  return (
    <DemoCard
      name="Chart Watermark"
      importPath="Pattern — SondeMark + SondeWordmark"
      description="Branding watermark centered behind chart content at low opacity. Used in PriceChart, AmendmentVoteChart, and all analytics charts."
      preview={
        <div className="relative w-full overflow-hidden rounded-lg border border-elevated bg-surface" style={{ minHeight: 200 }}>
          {/* Mock chart grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between px-4 py-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-px w-full bg-elevated" />
            ))}
          </div>

          {/* Mock chart bars */}
          <div className="absolute inset-x-0 bottom-4 flex items-end justify-center gap-3 px-8">
            {[40, 65, 50, 80, 55, 70, 45, 75, 60, 85].map((h, i) => (
              <div
                key={i}
                className="w-6 rounded-t bg-brand/20"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>

          {/* Watermark */}
          <div
            className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center text-primary"
            style={{ opacity: opacity / 100 }}
          >
            <div className="flex items-center gap-3">
              <SondeMark size={56} />
              <SondeWordmark height={44} />
            </div>
          </div>
        </div>
      }
      controls={
        <NumberControl
          label="opacity (%)"
          value={opacity}
          onChange={setOpacity}
          min={1}
          max={10}
          step={1}
        />
      }
      code={`<div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center text-primary opacity-[${(opacity / 100).toFixed(2)}]">\n  <div className="flex items-center gap-3">\n    <SondeMark size={56} />\n    <SondeWordmark height={44} />\n  </div>\n</div>`}
    />
  );
}
