"use client";

import { useState } from "react";
import { SondeMark, SondeWordmark } from "@/components/shared/SondeLogo";
import DemoCard from "../shared/DemoCard";
import { NumberControl } from "../shared/PropControl";

export default function LogoDemo() {
  const [markSize, setMarkSize] = useState(32);
  const [wordmarkHeight, setWordmarkHeight] = useState(24);

  return (
    <DemoCard
      name="SondeLogo"
      importPath="@/components/shared/SondeLogo"
      description="Brand mark and wordmark. SondeWordmark supports animated entrance via staggerDelay prop."
      preview={
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <SondeMark size={markSize} className="text-primary" />
            <span className="font-mono text-label text-muted">SondeMark</span>
          </div>
          <div className="h-12 w-px bg-elevated" />
          <div className="flex flex-col items-center gap-2">
            <SondeWordmark height={wordmarkHeight} className="text-primary" />
            <span className="font-mono text-label text-muted">SondeWordmark</span>
          </div>
        </div>
      }
      controls={
        <>
          <NumberControl label="Mark Size" value={markSize} onChange={setMarkSize} min={16} max={64} />
          <NumberControl label="Wordmark Height" value={wordmarkHeight} onChange={setWordmarkHeight} min={12} max={48} />
        </>
      }
      code={`<SondeMark size={${markSize}} />
<SondeWordmark height={${wordmarkHeight}} />`}
    />
  );
}
