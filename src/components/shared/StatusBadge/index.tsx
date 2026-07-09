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
        "inline-block rounded-full px-2.5 py-0.5 font-mono text-label font-semibold uppercase tracking-wide",
        isSuccess ? "bg-success/8 text-success" : "bg-error/8 text-error",
        className
      )}
    >
      {label ?? (isSuccess ? "Validated" : "Failed")}
    </span>
  );
}

export default StatusBadge;
