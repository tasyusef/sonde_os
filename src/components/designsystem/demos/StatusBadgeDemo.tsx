import { useState } from "react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import DemoCard from "../shared/DemoCard";
import { SelectControl, TextControl } from "../shared/PropControl";

export default function StatusBadgeDemo() {
  const [status, setStatus] = useState<"success" | "error">("success");
  const [label, setLabel] = useState("");

  return (
    <DemoCard
      name="StatusBadge"
      importPath="@/components/shared/StatusBadge"
      description="Pill-shaped status indicator. Defaults to 'Validated' or 'Failed' based on status prop."
      preview={<StatusBadge status={status} label={label || undefined} />}
      controls={
        <>
          <SelectControl
            label="status"
            value={status}
            options={[
              { value: "success", label: "success" },
              { value: "error", label: "error" },
            ]}
            onChange={(v) => setStatus(v as "success" | "error")}
          />
          <TextControl
            label="label"
            value={label}
            onChange={setLabel}
            placeholder="Custom label..."
          />
        </>
      }
      code={`<StatusBadge status="${status}"${label ? ` label="${label}"` : ""} />`}
    />
  );
}
