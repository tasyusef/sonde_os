import { useState } from "react";
import { AddressLink } from "@/components/shared/AddressLink";
import DemoCard from "../shared/DemoCard";
import { ToggleControl, NumberControl } from "../shared/PropControl";

const EXAMPLE_ADDRESS = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";

export default function AddressLinkDemo() {
  const [truncate, setTruncate] = useState(true);
  const [chars, setChars] = useState(5);

  return (
    <DemoCard
      name="AddressLink"
      importPath="@/components/shared/AddressLink"
      description="Linked XRPL address with truncation. Monospace, brand salmon color."
      preview={
        // Swallows the link's click (mouse or Enter) so the demo doesn't navigate.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <span onClick={(e) => e.preventDefault()}>
          <AddressLink address={EXAMPLE_ADDRESS} truncate={truncate} chars={chars} />
        </span>
      }
      controls={
        <>
          <ToggleControl label="truncate" checked={truncate} onChange={setTruncate} />
          <NumberControl label="chars" value={chars} onChange={setChars} min={3} max={15} />
        </>
      }
      code={`<AddressLink address="${EXAMPLE_ADDRESS}" truncate={${truncate}} chars={${chars}} />`}
    />
  );
}
