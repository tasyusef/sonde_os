import Button from "@/components/shared/Button";
import { cn } from "@/lib/utils";

export interface NoticeAction {
  label: string;
  onClick: () => void;
}

/** A line that stands in for a list or section on the page ground: the
 *  empty state, or (with `tone="error"`) a failed request, announced via
 *  `role="alert"`. */
export default function ListNotice({
  message,
  tone = "muted",
  action,
}: {
  message: string;
  tone?: "muted" | "error";
  action?: NoticeAction;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <p className={cn("font-mono text-cell", tone === "error" ? "text-error" : "text-muted")}>
        {message}
      </p>
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
