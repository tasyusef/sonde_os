import { useState } from "react";
import { SondeMark, SondeWordmark } from "@/components/shared/SondeLogo";
import DemoCard from "../shared/DemoCard";
import { NumberControl } from "../shared/PropControl";

export default function LogoDemo() {
  const [markScale, setMarkScale] = useState(2);
  const [wordmarkScale, setWordmarkScale] = useState(2);

  return (
    <DemoCard
      name="SondeLogo"
      importPath="@/components/shared/SondeLogo"
      description="Bitmap mark and wordmark, sized in whole pixels per cell."
      preview={
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <SondeMark scale={markScale} className="text-primary" />
            <span className="font-mono text-label text-muted">SondeMark</span>
          </div>
          <div className="h-12 w-px bg-elevated" />
          <div className="flex flex-col items-center gap-2">
            <SondeWordmark scale={wordmarkScale} className="text-primary" />
            <span className="font-mono text-label text-muted">SondeWordmark</span>
          </div>
        </div>
      }
      controls={
        <>
          <NumberControl label="Mark Scale" value={markScale} onChange={setMarkScale} min={1} max={6} />
          <NumberControl label="Wordmark Scale" value={wordmarkScale} onChange={setWordmarkScale} min={1} max={6} />
        </>
      }
      code={`<SondeMark scale={${markScale}} />
<SondeWordmark scale={${wordmarkScale}} />`}
    />
  );
}
