import { cn } from "@/lib/utils";

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: "success" | "error";
  label?: string;
  className?: string;
}) {
  const isSuccess = status === "success";

  return (
    <span
      className={cn(
        "inline-block rounded-tag px-1.5 py-0.5 font-mono text-label uppercase",
        isSuccess ? "tag-success" : "tag-error",
        className
      )}
    >
      {label ?? (isSuccess ? "Validated" : "Failed")}
    </span>
  );
}

export default StatusBadge;
