"use client";

import { useState } from "react";
import Toggle from "@/components/shared/Toggle";
import DemoCard from "../shared/DemoCard";

const options = [
  { value: "1H", label: "1H" },
  { value: "24H", label: "24H" },
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
  { value: "ALL", label: "ALL" },
];

export default function ToggleDemo() {
  const [active, setActive] = useState("24H");

  return (
    <DemoCard
      name="Toggle"
      importPath="@/components/shared/Toggle"
      description="Universal toggle primitive. Pill-style button group with a sliding background pill. Used for period selectors, filters, payment methods, view modes — anywhere the user picks exactly one option from a small set."
      preview={
        <Toggle options={options} active={active} onChange={setActive} />
      }
      code={`<Toggle
  options={[${options.map((p) => `{ value: "${p.value}", label: "${p.label}" }`).join(", ")}]}
  active="${active}"
  onChange={setActive}
/>`}
    />
  );
}
