"use client";

import { useState } from "react";
import DropdownMenu from "@/components/shared/DropdownMenu";
import DemoCard from "../shared/DemoCard";

const OPTIONS = [
  { value: "all", label: "All routes" },
  { value: "/", label: "/" },
  { value: "/markets", label: "/markets" },
  { value: "/network", label: "/network" },
  { value: "/nft", label: "/nft" },
  { value: "/admin", label: "/admin" },
];

export default function DropdownMenuDemo() {
  const [selected, setSelected] = useState("all");
  const selectedLabel = OPTIONS.find((o) => o.value === selected)?.label ?? "Select";

  return (
    <DemoCard
      name="DropdownMenu"
      importPath="@/components/shared/DropdownMenu"
      description="Reusable dropdown menu with outside-click, escape-key, and a11y handled internally. Renders a Button trigger + listbox menu. If onSelect + selectedValue are provided, it acts as a listbox (shows check icon on selected item). Otherwise it's a plain action menu."
      preview={
        <div className="flex items-center justify-center p-8">
          <DropdownMenu
            triggerLabel={selectedLabel}
            items={OPTIONS}
            selectedValue={selected}
            onSelect={setSelected}
            label="Filter by route"
          />
        </div>
      }
      code={`<DropdownMenu
  triggerLabel="${selectedLabel}"
  items={[
    { value: "all", label: "All routes" },
    { value: "/", label: "/" },
    { value: "/markets", label: "/markets" },
  ]}
  selectedValue="${selected}"
  onSelect={setSelected}
  label="Filter by route"
/>`}
    />
  );
}
