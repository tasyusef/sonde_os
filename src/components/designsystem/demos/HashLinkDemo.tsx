"use client";

import { useState } from "react";
import { HashLink } from "@/components/shared/HashLink";
import DemoCard from "../shared/DemoCard";
import { ToggleControl, NumberControl } from "../shared/PropControl";

const EXAMPLE_HASH = "8A3F2E9B1C4D5A6F7E8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E4F5A6B7C8D9E0F";

export default function HashLinkDemo() {
  const [truncate, setTruncate] = useState(true);
  const [chars, setChars] = useState(5);

  return (
    <DemoCard
      name="HashLink"
      importPath="@/components/shared/HashLink"
      description="Linked transaction hash with truncation. Monospace, subtle color with hover."
      preview={
        <span onClick={(e) => e.preventDefault()}>
          <HashLink hash={EXAMPLE_HASH} truncate={truncate} chars={chars} />
        </span>
      }
      controls={
        <>
          <ToggleControl label="truncate" checked={truncate} onChange={setTruncate} />
          <NumberControl label="chars" value={chars} onChange={setChars} min={3} max={15} />
        </>
      }
      code={`<HashLink hash="${EXAMPLE_HASH}" truncate={${truncate}} chars={${chars}} />`}
    />
  );
}
