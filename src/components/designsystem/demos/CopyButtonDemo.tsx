"use client";

import { useState } from "react";
import CopyButton from "@/components/shared/CopyButton";
import DemoCard from "../shared/DemoCard";
import { TextControl } from "../shared/PropControl";

export default function CopyButtonDemo() {
  const [text, setText] = useState("rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY");

  return (
    <DemoCard
      name="CopyButton"
      importPath="@/components/shared/CopyButton"
      description="Clipboard icon with animated check feedback on copy. Resets after 2 seconds."
      preview={
        <div className="flex items-center gap-2">
          <span className="font-mono text-cell text-secondary">{text}</span>
          <CopyButton text={text} />
        </div>
      }
      controls={
        <TextControl label="text" value={text} onChange={setText} placeholder="Text to copy" />
      }
      code={`<CopyButton text="${text}" />`}
    />
  );
}
