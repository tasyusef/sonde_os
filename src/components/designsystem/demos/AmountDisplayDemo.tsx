import { useState } from "react";
import { AmountDisplay } from "@/components/shared/AmountDisplay";
import DemoCard from "../shared/DemoCard";
import { ToggleControl, TextControl } from "../shared/PropControl";

const presets = [
  { label: "1 XRP", drops: "1000000" },
  { label: "100 XRP", drops: "100000000" },
  { label: "-50 XRP", drops: "-50000000" },
  { label: "0", drops: "0" },
];

export default function AmountDisplayDemo() {
  const [drops, setDrops] = useState("1000000");
  const [showSign, setShowSign] = useState(false);

  return (
    <DemoCard
      name="AmountDisplay"
      importPath="@/components/shared/AmountDisplay"
      description="XRP amount with sign prefix and semantic coloring. Converts drops to XRP automatically."
      preview={<AmountDisplay drops={drops} showSign={showSign} />}
      controls={
        <>
          <TextControl
            label="drops"
            value={drops}
            onChange={setDrops}
            placeholder="Amount in drops"
          />
          <ToggleControl label="showSign" checked={showSign} onChange={setShowSign} />
          <div>
            <span className="mb-1 block font-display text-caps uppercase tracking-header text-muted">
              Presets
            </span>
            <div className="flex gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setDrops(p.drops)}
                  className="bg-dither px-2 py-1 font-mono text-label text-primary hover:bg-primary hover:text-black"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </>
      }
      code={`<AmountDisplay drops="${drops}" showSign={${showSign}} />`}
    />
  );
}
