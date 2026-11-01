import { useState } from "react";
import Button from "@/components/shared/Button";
import Collapse from "@/components/shared/Collapse";
import { cn } from "@/lib/utils";

type ViewMode = "json" | "receipt";

const VIEWS: { value: ViewMode; label: string }[] = [
  { value: "json", label: "Raw JSON" },
  { value: "receipt", label: "Transaction receipt" },
];

/** Two disclosure buttons, at most one open: the full tx object or just
 *  its meta (the receipt). Pressing the open one closes it, which a
 *  radio `Toggle` can't do, so these are pressed buttons. */
export default function RawJsonToggle({
  tx,
  meta,
  className,
}: {
  tx: Record<string, unknown>;
  meta: Record<string, unknown> | null;
  className?: string;
}) {
  // The view outlives `open`, so the box keeps its text while it closes.
  const [view, setView] = useState<ViewMode>("json");
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {VIEWS.map(({ value, label }) => {
          const pressed = open && view === value;
          return (
            <Button
              key={value}
              variant="secondary"
              size="md"
              aria-pressed={pressed}
              onClick={() => {
                setView(value);
                setOpen(!pressed);
              }}
              className={cn("whitespace-nowrap", pressed && "bg-primary text-black")}
            >
              {label}
            </Button>
          );
        })}
      </div>
      <Collapse open={open}>
        <pre className="mt-3 max-h-150 overflow-auto border border-line p-4 font-mono text-cell text-primary">
          {JSON.stringify(view === "json" ? tx : (meta ?? {}), null, 2)}
        </pre>
      </Collapse>
    </div>
  );
}
